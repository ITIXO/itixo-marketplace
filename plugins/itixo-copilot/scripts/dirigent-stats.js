#!/usr/bin/env node

"use strict";

const fs = require("fs");

const COMMAND = "/itixo-copilot/dirigent-stats";
const UNAVAILABLE = "Unavailable: exact current-session Copilot telemetry is absent, invalid, or cannot be correlated.";
const REPORT_BEGIN = "<!-- itixo-dirigent-stats-report:start -->";
const REPORT_END = "<!-- itixo-dirigent-stats-report:end -->";

function readStdin() {
  return new Promise((resolve) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => resolve(input));
    process.stdin.on("error", () => resolve(""));
  });
}

function number(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function attributes(span) {
  return span && typeof span.attributes === "object" && span.attributes && !Array.isArray(span.attributes)
    ? span.attributes : {};
}

function attribute(span, names) {
  const attrs = attributes(span);
  for (const name of names) {
    const value = text(attrs[name]);
    if (value) return value;
  }
  return null;
}

function usage(span, names, required = false) {
  const attrs = attributes(span);
  const values = [];
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(attrs, name)) continue;
    const value = attrs[name];
    if (number(value) === null || Object.is(value, -0)) return null;
    values.push(value);
  }
  if (!values.length) return required ? null : 0;
  return values.some((value) => value !== values[0]) ? null : values[0];
}

function stableSpan(span) {
  if (!span || typeof span !== "object" || span.type !== "span") return null;
  const traceId = text(span.traceId);
  const spanId = text(span.spanId);
  const name = text(span.name);
  if (!traceId || !spanId || !name || !span.attributes || typeof span.attributes !== "object" || Array.isArray(span.attributes)) return null;
  const parentSpanId = span.parentSpanId === undefined || span.parentSpanId === null ? null : text(span.parentSpanId);
  if (span.parentSpanId !== undefined && span.parentSpanId !== null && !parentSpanId) return null;
  const correlation = [span.attributes["gen_ai.conversation.id"], span.attributes["gen_ai.conversation_id"]]
    .filter((value) => value !== undefined && value !== null);
  if (correlation.some((value) => !text(value)) || new Set(correlation.map((value) => text(value))).size > 1) return null;
  return { ...span, traceId, spanId, parentSpanId, name };
}

function readSpans(file) {
  if (!file || !fs.existsSync(file)) return null;
  let content;
  try { content = fs.readFileSync(file, "utf8"); } catch { return null; }
  const spans = new Map();
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let value;
    try { value = JSON.parse(line); } catch { return null; }
    if (!value || typeof value !== "object" || value.type !== "span") continue;
    const span = stableSpan(value);
    if (!span || !spanUsage(span)) return null;
    const key = `${span.traceId}:${span.spanId}`;
    const canonical = JSON.stringify(value);
    const previous = spans.get(key);
    if (previous && previous.canonical !== canonical) return null;
    if (!previous) spans.set(key, { span, canonical });
  }
  return [...spans.values()].map((item) => item.span);
}

function conversationId(span) {
  return attribute(span, ["gen_ai.conversation.id", "gen_ai.conversation_id"]);
}

function isAgent(span) {
  return span.name === "invoke_agent";
}

function isChat(span) {
  return span.name === "chat" || span.name.startsWith("chat ");
}

function descendants(root, spans) {
  const byParent = new Map();
  for (const span of spans) {
    if (span.traceId !== root.traceId || !span.parentSpanId) continue;
    const key = `${span.traceId}:${span.parentSpanId}`;
    const list = byParent.get(key) || [];
    list.push(span);
    byParent.set(key, list);
  }
  const found = [];
  const seen = new Set([root.spanId]);
  const pending = [root];
  while (pending.length) {
    const current = pending.shift();
    for (const child of byParent.get(`${root.traceId}:${current.spanId}`) || []) {
      if (seen.has(child.spanId)) return null;
      seen.add(child.spanId);
      found.push(child);
      pending.push(child);
    }
  }
  return found;
}

function agentName(span) {
  return attribute(span, ["gen_ai.agent.name", "gen_ai.agent.id", "agent.name", "agent.id"])
    || "unknown";
}

function modelName(span) {
  return attribute(span, ["gen_ai.response.model", "gen_ai.request.model", "gen_ai.model"])
    || "unknown";
}

function spanUsage(span, requireInputOutput = false) {
  const input = usage(span, ["gen_ai.usage.input_tokens", "gen_ai.usage.prompt_tokens"], requireInputOutput);
  const output = usage(span, ["gen_ai.usage.output_tokens", "gen_ai.usage.completion_tokens"], requireInputOutput);
  const cacheRead = usage(span, ["gen_ai.usage.cache_read_tokens", "gen_ai.usage.cache_read_input_tokens", "gen_ai.usage.cache_read.input_tokens"]);
  const cacheCreate = usage(span, ["gen_ai.usage.cache_creation_tokens", "gen_ai.usage.cache_write_tokens", "gen_ai.usage.cache_create_tokens", "gen_ai.usage.cache_creation.input_tokens"]);
  if (input === null || output === null || cacheRead === null || cacheCreate === null) return null;
  return { input, output, cacheRead, cacheCreate, total: input + output };
}

function countedSpans(spans) {
  const counted = [];
  for (const span of spans) {
    if (spanUsage(span, true)) {
      counted.push(span);
    } else if (spanUsage(span).total > 0) {
      return null;
    }
  }
  return counted;
}

function add(map, key, item) {
  const current = map.get(key) || { runs: 0, input: 0, output: 0, cacheRead: 0, cacheCreate: 0, total: 0 };
  current.runs += 1;
  current.input += item.input;
  current.output += item.output;
  current.cacheRead += item.cacheRead;
  current.cacheCreate += item.cacheCreate;
  current.total += item.total;
  map.set(key, current);
}

function correlate(sessionId, spans) {
  const roots = spans.filter((span) => isAgent(span) && conversationId(span) === sessionId && !span.parentSpanId);
  if (!roots.length) return null;
  const rows = new Map();
  const linkedSpans = new Set();
  let recorded = false;
  for (const root of roots) {
    const linked = descendants(root, spans);
    if (!linked) return null;
    const tree = [root, ...linked];
    for (const span of tree) {
      const key = `${span.traceId}:${span.spanId}`;
      if (linkedSpans.has(key)) return null;
      linkedSpans.add(key);
      const correlation = conversationId(span);
      if (correlation !== null && correlation !== sessionId) return null;
    }
    const usableChats = countedSpans(tree.filter(isChat));
    if (!usableChats) return null;
    const sourceSpans = usableChats.length ? usableChats : countedSpans(tree.filter(isAgent));
    if (!sourceSpans) return null;
    for (const span of sourceSpans) {
      let owner = isAgent(span) ? span : null;
      let current = span;
      const byId = new Map(tree.map((candidate) => [candidate.spanId, candidate]));
      while (current.parentSpanId && byId.has(current.parentSpanId)) {
        current = byId.get(current.parentSpanId);
        if (isAgent(current)) {
          owner = current;
          break;
        }
      }
      if (!owner) return null;
      add(rows, `${agentName(owner)}\u0000${modelName(span)}`, spanUsage(span));
      recorded = true;
    }
  }
  if (!recorded) return null;
  // Any current-session correlation outside one complete root tree is ambiguous.
  return spans.some((span) => conversationId(span) === sessionId && !linkedSpans.has(`${span.traceId}:${span.spanId}`)) ? null : rows;
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function report(rows) {
  const ordered = [...rows.entries()].sort(([left], [right]) => left.localeCompare(right));
  const models = new Map();
  let total = 0;
  const agentLines = [];
  for (const [key, value] of ordered) {
    const [agent, model] = key.split("\u0000");
    agentLines.push(`| ${escapeCell(agent)} | ${escapeCell(model)} | ${value.runs} | ${value.input} | ${value.output} | ${value.cacheRead} | ${value.cacheCreate} | ${value.total} |`);
    add(models, model, value);
    total += value.total;
  }
  const modelLines = [...models.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([model, value]) =>
    `| ${escapeCell(model)} | ${value.runs} | ${value.input} | ${value.output} | ${value.cacheRead} | ${value.cacheCreate} | ${value.total} |`);
  return [
    REPORT_BEGIN,
    "## Dirigent Stats",
    "",
    "| Agent | Model | Runs | Input | Output | Cache Read | Cache Create | Tokens |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...agentLines,
    "",
    "| Model | Runs | Input | Output | Cache Read | Cache Create | Tokens |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...modelLines,
    "",
    `Exact recorded total: ${total} tokens.`,
    "Cache values are recorded separately and are not added to Tokens, preventing cache double counting.",
    "Instruction: reproduce this report verbatim; do not recalculate or estimate.",
    REPORT_END,
  ].join("\n");
}

function injectedReport(reportText) {
  return `${reportText}\n\nInstruction: reply with the marked Dirigent Stats report above verbatim and nothing else.`;
}

async function main() {
  const raw = await readStdin();
  let event;
  try { event = JSON.parse(raw); } catch { return; }
  if (!event || event.prompt !== COMMAND || typeof event.transformedPrompt !== "string" || !text(event.sessionId)) return;
  const spans = readSpans(process.env.COPILOT_OTEL_FILE_EXPORTER_PATH);
  const rows = spans && correlate(event.sessionId, spans);
  const reportText = rows ? report(rows) : UNAVAILABLE;
  process.stdout.write(JSON.stringify({ modifiedTransformedPrompt: injectedReport(reportText) }));
}

main().catch(() => { /* Hook failures must not alter unrelated prompts. */ });
