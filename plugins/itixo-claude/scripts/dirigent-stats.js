#!/usr/bin/env node
// UserPromptSubmit/Stop hooks: exact cumulative token report for explicit stats.
// Stop refreshes a compact per-session cache; prompt handling normally reads it.
"use strict";

const fs = require("fs");
const crypto = require("crypto");
const os = require("os");
const path = require("path");

const REQUEST = /(?:^|\s)[/$]dirigent-stats(?=$|\s|[.,!?;:])/;
const USAGE_FIELDS = ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"];
const STATE_SCHEMA = 2;
const CACHE_SCHEMA = 1;
const DEFAULT_TIMEOUT_MS = 1500;

function stateDir() {
  return process.env.DIRIGENT_STATS_STATE_DIR || path.join(process.env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), ".claude"), "dirigent-stats");
}

function stateFile(sessionId) {
  const directory = stateDir();
  return path.join(directory, `${crypto.createHash("sha256").update(sessionId).digest("hex")}.json`);
}

function sessionState(sessionId) {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile(sessionId), "utf8"));
    return state && (state.schema === 1 || state.schema === STATE_SCHEMA) && state.sessionId === sessionId
      && (state.transcriptPath === null || typeof state.transcriptPath === "string") ? state : null;
  } catch { return null; }
}

function validCache(cache, state, sessionId) {
  return state && state.schema === STATE_SCHEMA && cache && cache.schema === CACHE_SCHEMA
    && cache.sessionId === sessionId && cache.transcriptPath === state.transcriptPath
    && typeof cache.report === "string" && cache.report.includes("<!-- itixo-dirigent-stats-report:start -->")
    && cache.report.includes("## Dirigent Stats") && cache.report.includes("### Agents")
    && cache.report.includes("### Models") && cache.report.includes("<!-- itixo-dirigent-stats-report:end -->");
}

function timeoutMs() {
  const value = Number(process.env.DIRIGENT_STATS_TIMEOUT_MS);
  return Number.isFinite(value) ? Math.max(100, Math.min(Math.floor(value), 5000)) : DEFAULT_TIMEOUT_MS;
}

function expired(deadline) {
  return Date.now() > deadline;
}

function atomicStateWrite(file, state) {
  const directory = path.dirname(file);
  const temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`);
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(temporary, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, file);
    fs.chmodSync(file, 0o600);
  } finally {
    try { fs.unlinkSync(temporary); } catch { /* Renamed or never created. */ }
  }
}

function readJsonLines(file) {
  try {
    return fs.readFileSync(file, "utf8").split("\n").flatMap((line) => {
      if (!line.trim()) return [];
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  } catch { return []; }
}

function walkJsonl(dir, deadline) {
  const files = [];
  const visit = (current) => {
    if (expired(deadline)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) visit(candidate);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(candidate);
    }
  };
  try { visit(dir); } catch { return []; }
  return files.sort();
}

function recordSessionId(record) {
  return record.sessionId || record.session_id;
}

function validTranscriptSession(records, sessionId) {
  let present = false;
  for (const record of records) {
    const actual = recordSessionId(record);
    if (actual === undefined) continue;
    if (actual !== sessionId) return false;
    present = true;
  }
  return present;
}

function sessionFiles(transcript, rootSessionId, deadline) {
  const root = path.resolve(transcript);
  if (path.basename(root, ".jsonl") !== rootSessionId) return [];
  const rootRecords = readJsonLines(root);
  if (!validTranscriptSession(rootRecords, rootSessionId)) return [];

  // Claude stores descendants only below <project>/<root-session>/subagents/.
  // Do not scan sibling root sessions, choose newest files, or infer a parent from mtime.
  const descendants = walkJsonl(path.join(path.dirname(root), rootSessionId, "subagents"), deadline);
  return [root, ...descendants.filter((file) => {
    const records = readJsonLines(file);
    const sessionId = records.map(recordSessionId).find((id) => typeof id === "string" && id);
    return typeof sessionId === "string" && validTranscriptSession(records, sessionId);
  })].sort();
}

function findExactTranscript(projectsDir, sessionId, deadline) {
  const matches = [];
  const visit = (current) => {
    if (expired(deadline)) return;
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

function noDataReport() {
  return markdown({ agents: new Map(), models: new Map(), warnings: ["No exact assistant usage records were available."] }, 0);
}

function transcriptFor(state, projects, sessionId, deadline) {
  return state && state.transcriptPath === null ? findExactTranscript(projects, sessionId, deadline) : state && state.transcriptPath;
}

function buildReport(state, sessionId, deadline) {
  if (!state || expired(deadline)) return noDataReport();
  const projects = process.env.DIRIGENT_STATS_CLAUDE_PROJECTS_DIR || path.join(os.homedir(), ".claude", "projects");
  const transcript = transcriptFor(state, projects, sessionId, deadline);
  if (!transcript || !fs.existsSync(transcript) || expired(deadline)) return noDataReport();
  const files = sessionFiles(transcript, sessionId, deadline);
  if (!files.length || expired(deadline)) return noDataReport();

  const warnings = [];
  const entries = [];
  for (const file of files) {
    if (expired(deadline)) return noDataReport();
    const records = readJsonLines(file);
    const transcriptAgentId = records.map(agentId).find(Boolean);
    const latestByMessageId = new Map();
    for (const record of records) {
      if (expired(deadline)) return noDataReport();
      if (record.type !== "assistant" || !record.message || typeof record.message !== "object" || isDisplaySummary(record)) continue;
      const usage = exactUsage(record);
      if (usage === null) { warnings.push("Some assistant usage records were unavailable and excluded."); continue; }
      const messageId = record.message.id;
      if (typeof messageId !== "string" || !messageId) {
        warnings.push("Some assistant usage records lacked stable message IDs and were excluded.");
        continue;
      }
      latestByMessageId.set(messageId, { file, id: agentId(record) || transcriptAgentId, model: modelName(record), tokens: usage });
    }
    entries.push(...latestByMessageId.values());
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
  return markdown(rows, [...rows.agents.values()].reduce((sum, row) => sum + row.tokens, 0));
}

function cacheReport(state, sessionId, report) {
  if (!state) return;
  const next = {
    schema: STATE_SCHEMA,
    sessionId,
    transcriptPath: state.transcriptPath,
    cwd: typeof state.cwd === "string" ? state.cwd : null,
    source: typeof state.source === "string" ? state.source : "unknown",
    cache: { schema: CACHE_SCHEMA, sessionId, transcriptPath: state.transcriptPath, report, createdAt: new Date().toISOString() },
  };
  atomicStateWrite(stateFile(sessionId), next);
}

let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const stop = process.argv.includes("--cache");
    const sessionId = event.session_id;
    if (typeof sessionId !== "string" || !sessionId) return;
    const state = sessionState(sessionId);
    const deadline = Date.now() + timeoutMs();
    if (stop) {
      // Stop has no user-facing output. A timeout or malformed transcript still
      // writes a deterministic no-data cache and never blocks session shutdown.
      cacheReport(state, sessionId, buildReport(state, sessionId, deadline));
      return;
    }
    const prompt = typeof event.prompt === "string" ? event.prompt : typeof event.user_prompt === "string" ? event.user_prompt : "";
    if (!REQUEST.test(prompt)) return;
    const report = validCache(state && state.cache, state, sessionId)
      ? state.cache.report
      : buildReport(state, sessionId, deadline);
    // Legacy, missing, and corrupt cache recover once from anchored data. Keep
    // prompt response deterministic even when no completed transcript exists.
    if (!validCache(state && state.cache, state, sessionId)) cacheReport(state, sessionId, report);
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: report } }) + "\n");
  } catch {
    // Never block prompt submission.
  }
});
