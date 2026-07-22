#!/usr/bin/env node
// UserPromptSubmit hook: exact cumulative token report for an explicit stats request.
// Deliberately fail-open: malformed or unavailable local data emits nothing.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const REQUEST = /(?:^|\s)[/$]dirigent-stats(?=$|\s|[.,!?;:])/;
const USAGE_FIELDS = ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"];

function readJsonLines(file) {
  try {
    return fs.readFileSync(file, "utf8").split("\n").flatMap((line) => {
      if (!line.trim()) return [];
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  } catch { return []; }
}

function walkJsonl(dir) {
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) visit(candidate);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(candidate);
    }
  };
  try { visit(dir); } catch { return []; }
  return files.sort();
}

function sessionFiles(transcript, rootSessionId) {
  const root = path.resolve(transcript);
  const candidates = walkJsonl(path.dirname(root));
  const sessions = new Map();
  for (const file of candidates) {
    const meta = readJsonLines(file).find((record) => record.type === "session_meta") || {};
    const id = meta.session_id || meta.sessionId;
    if (typeof id === "string" && id) sessions.set(id, { file, parent: meta.parent_session_id || meta.parentSessionId });
  }
  const selected = new Set([root]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, session] of sessions) {
      if (id !== rootSessionId && selected.has(session.file)) continue;
      const parentIsRoot = session.parent === rootSessionId;
      const parent = sessions.get(session.parent);
      if (parentIsRoot || (parent && selected.has(parent.file))) {
        if (!selected.has(session.file)) { selected.add(session.file); changed = true; }
      }
    }
  }
  return [...selected].sort();
}

function findExactTranscript(projectsDir, sessionId) {
  const matches = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) visit(candidate);
      else if (entry.isFile() && entry.name === `${sessionId}.jsonl`) matches.push(candidate);
    }
  };
  try { visit(projectsDir); } catch { return null; }
  return matches.length === 1 ? matches[0] : null;
}

function agentId(record) {
  return record.agentId || record.agent_id || record.agent?.id || record.message?.agentId || record.message?.agent_id;
}

function modelName(record) {
  const model = record.message && record.message.model;
  return typeof model === "string" && model ? model : "unknown";
}

function exactUsage(record) {
  const usage = record.message && record.message.usage;
  if (!usage || typeof usage !== "object") return null;
  let total = 0;
  for (const field of USAGE_FIELDS) {
    const value = usage[field];
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) return null;
    total += Number.isFinite(value) ? value : 0;
  }
  return total;
}

function isDisplaySummary(record) {
  return Boolean(record.reporting_response || record.isSummary || record.summary || record.message?.isSummary || record.message?.summary);
}

function ledgerIdentity(ledgerFile, childIds) {
  const identities = new Map();
  for (const record of readJsonLines(ledgerFile)) {
    const id = agentId(record);
    const type = record.agentType || record.agent_type || record.subagent;
    if (id && childIds.has(id) && typeof type === "string" && type) identities.set(id, type);
  }
  return identities;
}

function markdown(rows, total) {
  const share = (value) => total ? `${((value / total) * 100).toFixed(1)}%` : "unknown";
  const agentRows = [...rows.agents.values()]
    .sort((a, b) => (a.role === "orchestrator" ? -1 : b.role === "orchestrator" ? 1 : b.tokens - a.tokens || a.role.localeCompare(b.role)))
    .map((row) => `| ${row.role} | ${[...row.models].sort().join(", ") || "unknown"} | ${row.runs.size} | ${row.tokens} | ${share(row.tokens)} |`);
  const modelRows = [...rows.models.values()]
    .sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model))
    .map((row) => `| ${row.model} | ${row.runs.size} | ${row.tokens} | ${share(row.tokens)} |`);
  return [
    "<!-- itixo-dirigent-stats-report:start -->",
    "Return the report below verbatim; do not recalculate, estimate, or add savings.",
    "## Dirigent Stats",
    "",
    "### Agents",
    "| Agent | Model | Runs | Tokens | Share |",
    "| --- | --- | ---: | ---: | ---: |",
    ...agentRows,
    "",
    "### Models",
    "| Model | Runs | Tokens | Share |",
    "| --- | ---: | ---: | ---: |",
    ...modelRows,
    "",
    "Snapshot: report excludes the reporting response; active totals are exact so far.",
    ...rows.warnings.map((warning) => `Warning: ${warning}`),
    "<!-- itixo-dirigent-stats-report:end -->",
  ].join("\n");
}

let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const prompt = typeof event.prompt === "string" ? event.prompt : typeof event.user_prompt === "string" ? event.user_prompt : "";
    if (!REQUEST.test(prompt)) return;
    const sessionId = event.session_id;
    if (typeof sessionId !== "string" || !sessionId) return;
    const projects = process.env.DIRIGENT_STATS_CLAUDE_PROJECTS_DIR || path.join(os.homedir(), ".claude", "projects");
    const transcript = typeof event.transcript_path === "string" && event.transcript_path
      ? event.transcript_path
      : findExactTranscript(projects, sessionId);
    if (!transcript || !fs.existsSync(transcript)) return;

    const files = sessionFiles(transcript, sessionId);
    if (!files.length) return;
    const warnings = [];
    const entries = [];
    for (const file of files) {
      const records = readJsonLines(file);
      const transcriptAgentId = records.map(agentId).find(Boolean);
      for (const record of records) {
        if (record.type !== "assistant" || !record.message || typeof record.message !== "object" || isDisplaySummary(record)) continue;
        const usage = exactUsage(record);
        if (usage === null) { warnings.push("Some assistant usage records were unavailable and excluded."); continue; }
        entries.push({ file, id: agentId(record) || transcriptAgentId, model: modelName(record), tokens: usage });
      }
    }
    if (!entries.length) warnings.push("No exact assistant usage records were available.");

    const childIds = new Set(entries.map((entry) => entry.id).filter(Boolean));
    const ledgerDir = process.env.DIRIGENT_STATS_CLAUDE_LEDGER_DIR || os.tmpdir();
    const identities = ledgerIdentity(path.join(ledgerDir, `itixo-delegation-${sessionId}.jsonl`), childIds);
    const rows = { agents: new Map(), models: new Map(), warnings: [...new Set(warnings)] };
    const rootFile = path.resolve(transcript);
    for (const entry of entries) {
      const child = path.resolve(entry.file) !== rootFile;
      const role = child && entry.id && identities.get(entry.id) ? identities.get(entry.id) : child ? "unknown" : "orchestrator";
      if (child && role === "unknown") rows.warnings.push("One or more child transcript identities were unavailable and shown as unknown.");
      if (!rows.agents.has(role)) rows.agents.set(role, { role, models: new Set(), runs: new Set(), tokens: 0 });
      const agent = rows.agents.get(role);
      agent.models.add(entry.model); agent.runs.add(entry.file); agent.tokens += entry.tokens;
      if (!rows.models.has(entry.model)) rows.models.set(entry.model, { model: entry.model, runs: new Set(), tokens: 0 });
      const model = rows.models.get(entry.model);
      model.runs.add(entry.file); model.tokens += entry.tokens;
    }
    rows.warnings = [...new Set(rows.warnings)];
    const total = [...rows.agents.values()].reduce((sum, row) => sum + row.tokens, 0);
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: markdown(rows, total) } }) + "\n");
  } catch {
    // Never block prompt submission.
  }
});
