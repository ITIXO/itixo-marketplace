#!/usr/bin/env node

const fs = require("fs");
const crypto = require("crypto");
const os = require("os");
const path = require("path");
const INVOCATION = /(^|\s)(?:\/|\$)dirigent-stats(?=$|[\s.,!?;:])/;
const STATE_SCHEMA = 2;
const STOP_BUDGET_MS = Number(process.env.DIRIGENT_STATS_STOP_BUDGET_MS) || 1500;

function stateDir() {
  return process.env.DIRIGENT_STATS_STATE_DIR || path.join(process.env.PLUGIN_DATA || path.join(os.homedir(), ".codex"), "dirigent-stats");
}

function stateFile(sessionId) {
  const dir = stateDir();
  return path.join(dir, `${crypto.createHash("sha256").update(sessionId).digest("hex")}.json`);
}

function sessionState(sessionId) {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile(sessionId), "utf8"));
    return state && (state.schema === 1 || state.schema === STATE_SCHEMA) && state.sessionId === sessionId
      && (state.transcriptPath === null || typeof state.transcriptPath === "string") ? state : null;
  } catch { return null; }
}

function cachedReport(state, sessionId) {
  const cache = state && state.schema === STATE_SCHEMA && state.cache;
  return cache && cache.sessionId === sessionId && cache.transcriptPath === state.transcriptPath && typeof cache.report === "string"
    && cache.report.includes("<!-- dirigent-stats:begin -->")
    && cache.report.includes("<!-- dirigent-stats:end -->") ? cache.report : null;
}

function noData() {
  return ["<!-- dirigent-stats:begin -->", "## Dirigent Stats", "", "No completed token usage available yet.", "", "Exact known total: 0 tokens.", "Snapshot: reporting response excluded; active values exact so far.", "Instruction: reproduce this report verbatim; do not recalculate or estimate.", "<!-- dirigent-stats:end -->"].join("\n");
}

function writeState(sessionId, anchor, reportText, turnId) {
  try {
    const dir = stateDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = stateFile(sessionId);
    // Re-read immediately before write: preserve a newer SessionStart anchor.
    const current = sessionState(sessionId);
    const source = current || anchor || {};
    const state = {
      schema: STATE_SCHEMA,
      sessionId,
      transcriptPath: source.transcriptPath === null || typeof source.transcriptPath === "string" ? source.transcriptPath : null,
      cwd: typeof source.cwd === "string" ? source.cwd : null,
      source: typeof source.source === "string" ? source.source : "stop",
      cache: { sessionId, transcriptPath: source.transcriptPath === null || typeof source.transcriptPath === "string" ? source.transcriptPath : null, report: reportText, updatedAt: Date.now(), ...(typeof turnId === "string" && turnId ? { turnId } : {}) },
    };
    const temporary = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`);
    fs.writeFileSync(temporary, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, file);
  } catch { /* Hooks must fail open. */ }
}

function stdin() {
  return new Promise((resolve) => {
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { text += chunk; });
    process.stdin.on("end", () => resolve(text));
    process.stdin.on("error", () => resolve(""));
  });
}

function numeric(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function at(object, keys) {
  let value = object;
  for (const key of keys) {
    if (!value || typeof value !== "object") return undefined;
    value = value[key];
  }
  return value;
}

function jsonlFiles(dir, result = [], deadline = Infinity) {
  if (Date.now() > deadline) return result;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return result; }
  for (const entry of entries) {
    if (Date.now() > deadline) break;
    const item = path.join(dir, entry.name);
    if (entry.isDirectory()) jsonlFiles(item, result, deadline);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) result.push(item);
  }
  return result;
}

function records(file, deadline = Infinity) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return null; }
  const result = [];
  for (const line of text.split("\n")) {
    if (Date.now() > deadline) return null;
    if (!line.trim()) continue;
    try { result.push(JSON.parse(line)); } catch { /* tolerate incomplete trailing JSONL */ }
  }
  return result;
}

function meta(items) {
  return items && items.find((item) => item && item.type === "session_meta");
}

function rolloutId(metaRecord) {
  const payload = metaRecord && metaRecord.payload;
  return payload && typeof payload.id === "string" ? payload.id : null;
}

function resolveTranscript(event, sessionsDir, deadline = Infinity) {
  if (typeof event.transcript_path === "string" && event.transcript_path) {
    try { return fs.statSync(event.transcript_path).isFile() ? event.transcript_path : null; } catch { return null; }
  }
  const id = event.session_id || event.thread_id;
  if (typeof id !== "string" || !id) return null;
  for (const file of jsonlFiles(sessionsDir, [], deadline)) {
    if (Date.now() > deadline) return null;
    const metadata = meta(records(file, deadline));
    if (rolloutId(metadata) === id) return file;
  }
  return null;
}

function parseRollout(file, deadline = Infinity) {
  const items = records(file, deadline);
  const metadata = meta(items);
  const id = rolloutId(metadata);
  if (!id) return null;
  const session = metadata.payload || {};
  const turns = new Map();
  const models = new Map();
  const warnings = new Set();
  let activeTurn = null;
  let previousCumulative = 0;
  let total = null;

  items.forEach((item) => {
    if (Date.now() > deadline) return;
    const payload = item && item.payload && typeof item.payload === "object" ? item.payload : {};
    if (item.type === "turn_context") {
      const id = payload.turn_id || payload.id || item.turn_id;
      if (typeof id === "string" && id) {
        activeTurn = id;
        turns.set(id, {
          model: typeof payload.model === "string" && payload.model ? payload.model : "unknown",
        });
      } else {
        activeTurn = null;
        warnings.add("A turn has no ID; its model usage is unavailable.");
      }
    }
    const cumulative = numeric(at(payload, ["info", "total_token_usage", "total_tokens"]));
    const latest = numeric(at(payload, ["info", "last_token_usage", "total_tokens"]));
    if (cumulative !== null) {
      total = cumulative;
      const delta = cumulative - previousCumulative;
      const turnId = payload.turn_id || at(payload, ["info", "turn_id"]) || item.turn_id || activeTurn;
      const turn = typeof turnId === "string" ? turns.get(turnId) : null;
      if (delta > 0) {
        if (turn) models.set(turn.model, (models.get(turn.model) || 0) + delta);
        else warnings.add("A token event has no matching turn; model usage is unavailable.");
        if (latest !== null && latest !== delta) {
          warnings.add("Incremental usage disagrees with cumulative delta; cumulative delta used.");
        }
      } else if (delta < 0) {
        models.clear();
        if (latest === cumulative && turn) {
          models.set(turn.model, cumulative);
        } else if (latest === cumulative && !turn) {
          warnings.add("A token event has no matching turn; model usage is unavailable.");
        }
        warnings.add("Cumulative token usage reset; pre-reset model attribution is unavailable.");
        warnings.add("Partial report: pre-reset epoch is not represented by latest total.");
      }
      previousCumulative = cumulative;
    } else if (latest !== null) {
      warnings.add("A token event has no cumulative identity; model usage is unavailable.");
    }
  });

  if (total !== null) {
    const attributed = [...models.values()].reduce((sum, tokens) => sum + tokens, 0);
    if (attributed < total) {
      models.set("unknown", (models.get("unknown") || 0) + total - attributed);
      warnings.add("Unmatched exact token remainder is attributed to unknown model.");
    } else if (attributed > total) {
      models.clear();
      models.set("unknown", total);
      warnings.add("Model token events exceed exact rollout total; model attribution is unavailable.");
    }
  }
  return { id, parentId: session.parent_thread_id || null, role: session.agent_role || "unknown", total, models, warnings };
}

function currentReport(event, state, deadline = Infinity) {
  const sessionsDir = process.env.DIRIGENT_STATS_CODEX_SESSIONS_DIR || path.join(process.env.HOME || "", ".codex", "sessions");
  const sessionId = event.session_id || event.thread_id;
  if (typeof sessionId !== "string" || !sessionId || Date.now() > deadline) return null;
  const transcript = state && state.transcriptPath !== null ? state.transcriptPath : resolveTranscript(event, sessionsDir, deadline);
  const selected = transcript && parseRollout(transcript, deadline);
  if (!selected || selected.id !== sessionId || Date.now() > deadline) return null;
  const children = new Map();
  if (selected.parentId) children.set(selected.parentId, [selected]);
  for (const file of jsonlFiles(sessionsDir, [], deadline)) {
    if (Date.now() > deadline) return null;
    if (file === transcript) continue;
    const rollout = parseRollout(file, deadline);
    if (!rollout) continue;
    if (!rollout.parentId) continue;
    const items = children.get(rollout.parentId) || [];
    items.push(rollout);
    children.set(rollout.parentId, items);
  }
  const rollouts = [selected];
  const seen = new Set([selected.id]);
  const pending = [selected.id];
  while (pending.length) {
    if (Date.now() > deadline) return null;
    for (const child of (children.get(pending.shift()) || []).sort((a, b) => a.id.localeCompare(b.id))) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      rollouts.push(child);
      pending.push(child.id);
    }
  }
  return report(selected, rollouts);
}

function report(root, rollouts) {
  const agents = new Map();
  const models = new Map();
  const warnings = new Set();
  let total = 0;
  for (const rollout of rollouts) {
    for (const warning of rollout.warnings) warnings.add(warning);
    if (rollout.total === null) {
      warnings.add("Partial report: usage unavailable for one or more rollouts; excluded from totals.");
      continue;
    }
    total += rollout.total;
    const role = rollout.id === root.id ? "orchestrator" : rollout.role;
    const agent = agents.get(role) || { runs: 0, tokens: 0, models: new Set() };
    agent.runs += 1;
    agent.tokens += rollout.total;
    for (const [model, tokens] of rollout.models) {
      agent.models.add(model);
      const row = models.get(model) || { runs: new Set(), tokens: 0 };
      row.runs.add(rollout.id);
      row.tokens += tokens;
      models.set(model, row);
    }
    agents.set(role, agent);
  }
  const share = (tokens) => `${(total ? tokens * 100 / total : 0).toFixed(1)}%`;
  const agentRows = [...agents.entries()].sort(([a], [b]) => (a === "orchestrator" ? -1 : b === "orchestrator" ? 1 : agents.get(b).tokens - agents.get(a).tokens || a.localeCompare(b)));
  const modelRows = [...models.entries()].sort(([a], [b]) => models.get(b).tokens - models.get(a).tokens || a.localeCompare(b));
  const lines = [
    "<!-- dirigent-stats:begin -->",
    "## Dirigent Stats",
    "",
    "| Agent | Model | Runs | Tokens | Share |",
    "| --- | --- | ---: | ---: | ---: |",
    ...agentRows.map(([role, row]) => `| ${role} | ${[...row.models].sort().join(", ")} | ${row.runs} | ${row.tokens} | ${share(row.tokens)} |`),
    "",
    "| Model | Runs | Tokens | Share |",
    "| --- | ---: | ---: | ---: |",
    ...modelRows.map(([model, row]) => `| ${model} | ${row.runs.size} | ${row.tokens} | ${share(row.tokens)} |`),
    "",
    `Exact known total: ${total} tokens.`,
    "Snapshot: reporting response excluded; active values exact so far.",
  ];
  if (warnings.size) lines.push("Warnings:", ...[...warnings].sort().map((warning) => `- ${warning}`));
  lines.push("Instruction: reproduce this report verbatim; do not recalculate or estimate.", "<!-- dirigent-stats:end -->");
  return lines.join("\n");
}

async function main() {
  let event;
  try { event = JSON.parse(await stdin()); } catch { return; }
  const sessionId = event && (event.session_id || event.thread_id);
  const stop = event && (event.hook_event_name === "Stop" || event.hookEventName === "Stop"
    || (typeof event.turn_id === "string" && !(event.prompt || event.user_prompt || event.message)));
  if (stop) {
    if (typeof sessionId !== "string" || !sessionId) return;
    const state = sessionState(sessionId);
    const reportText = currentReport(event, state, Date.now() + Math.max(100, STOP_BUDGET_MS));
    if (reportText) writeState(sessionId, state, reportText, event.turn_id);
    return;
  }
  const prompt = event && (event.prompt || event.user_prompt || event.message || "");
  if (typeof prompt !== "string" || !INVOCATION.test(prompt)) return;
  if (typeof sessionId !== "string" || !sessionId) return;
  const state = sessionState(sessionId);
  let reportText = cachedReport(state, sessionId);
  if (!reportText) {
    // Schema-1/corrupt caches recover once on demand; normal requests never parse.
    reportText = currentReport(event, state, Date.now() + Math.max(100, STOP_BUDGET_MS));
    if (reportText) writeState(sessionId, state, reportText, event.turn_id);
  }
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: reportText || noData() } }));
}

main().catch(() => {});
