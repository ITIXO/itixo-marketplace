#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const INVOCATION = /(^|\s)(?:\/|\$)dirigent-stats(?=$|[\s.,!?;:])/;

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

function jsonlFiles(dir, result = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return result; }
  for (const entry of entries) {
    const item = path.join(dir, entry.name);
    if (entry.isDirectory()) jsonlFiles(item, result);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) result.push(item);
  }
  return result;
}

function records(file) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return null; }
  const result = [];
  for (const line of text.split("\n")) {
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

function resolveTranscript(event, sessionsDir) {
  if (typeof event.transcript_path === "string" && event.transcript_path) {
    try { return fs.statSync(event.transcript_path).isFile() ? event.transcript_path : null; } catch { return null; }
  }
  const id = event.session_id || event.thread_id;
  if (typeof id !== "string" || !id) return null;
  for (const file of jsonlFiles(sessionsDir)) {
    const metadata = meta(records(file));
    if (rolloutId(metadata) === id) return file;
  }
  return null;
}

function parseRollout(file) {
  const items = records(file);
  const metadata = meta(items);
  const id = rolloutId(metadata);
  if (!id) return null;
  const session = metadata.payload || {};
  const turns = new Map();
  const warnings = new Set();
  let activeTurn = null;
  let total = null;

  items.forEach((item, index) => {
    const payload = item && item.payload && typeof item.payload === "object" ? item.payload : {};
    if (item.type === "turn_context") {
      const id = payload.turn_id || payload.id || item.turn_id;
      if (typeof id === "string" && id) {
        activeTurn = id;
        const previous = turns.get(id);
        turns.set(id, {
          model: typeof payload.model === "string" && payload.model ? payload.model : "unknown",
          tokens: previous ? previous.tokens : null,
          index,
        });
      } else {
        activeTurn = null;
        warnings.add("A turn has no ID; its model usage is unavailable.");
      }
    }
    const cumulative = numeric(at(payload, ["info", "total_token_usage", "total_tokens"]));
    if (cumulative !== null) total = cumulative;
    const latest = numeric(at(payload, ["info", "last_token_usage", "total_tokens"]));
    if (latest !== null) {
      const turnId = payload.turn_id || at(payload, ["info", "turn_id"]) || item.turn_id || activeTurn;
      const turn = typeof turnId === "string" ? turns.get(turnId) : null;
      if (turn) turn.tokens = latest; // latest occurrence wins for this turn ID
      else warnings.add("A token event has no matching turn; model usage is unavailable.");
    }
  });

  const models = new Map();
  for (const turn of turns.values()) {
    if (turn.tokens !== null) models.set(turn.model, (models.get(turn.model) || 0) + turn.tokens);
  }
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
  const prompt = event && (event.prompt || event.user_prompt || event.message || "");
  if (typeof prompt !== "string" || !INVOCATION.test(prompt)) return;
  const sessionsDir = process.env.DIRIGENT_STATS_CODEX_SESSIONS_DIR || path.join(process.env.HOME || "", ".codex", "sessions");
  const transcript = resolveTranscript(event, sessionsDir);
  const selected = transcript && parseRollout(transcript);
  if (!selected) return;
  const children = new Map();
  const byId = new Map([[selected.id, selected]]);
  if (selected.parentId) children.set(selected.parentId, [selected]);
  for (const file of jsonlFiles(sessionsDir)) {
    if (file === transcript) continue;
    const rollout = parseRollout(file);
    if (!rollout) continue;
    byId.set(rollout.id, rollout);
    if (!rollout.parentId) continue;
    const items = children.get(rollout.parentId) || [];
    items.push(rollout);
    children.set(rollout.parentId, items);
  }
  let root = selected;
  while (root.parentId && byId.has(root.parentId)) root = byId.get(root.parentId);
  const rollouts = [root];
  const seen = new Set([root.id]);
  const pending = [root.id];
  while (pending.length) {
    for (const child of (children.get(pending.shift()) || []).sort((a, b) => a.id.localeCompare(b.id))) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      rollouts.push(child);
      pending.push(child.id);
    }
  }
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: report(root, rollouts) } }));
}

main().catch(() => {});
