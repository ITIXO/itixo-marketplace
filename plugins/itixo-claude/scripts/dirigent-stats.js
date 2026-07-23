#!/usr/bin/env node
// UserPromptSubmit/Stop hooks: exact cumulative token report for explicit stats.
// Stop refreshes a compact per-session cache; prompt handling normally reads it.
"use strict";

const fs = require("fs");
const crypto = require("crypto");
const os = require("os");
const path = require("path");

const REQUEST = /(?:^|\s)[/$](?:dirigent-stats|itixo-claude:dirigent-stats)(?=$|\s|[.,!?;:](?=$|\s))/;
const DIRECT_SLASH_REQUEST = /^\/(?:dirigent-stats|itixo-claude:dirigent-stats)(?=$|\s)/;
const EXPANSION_COMMANDS = new Set(["dirigent-stats", "itixo-claude:dirigent-stats"]);
const USAGE_FIELDS = ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"];
const STATE_SCHEMA = 2;
const CACHE_SCHEMA = 2;
const DEFAULT_TIMEOUT_MS = 1500;
const NO_DATA = "No token usage available yet.";
const INVALID_VIEW = "Invalid stats view. Use agents, models, or both.";
const VIEWS = ["both", "agents", "models"];
const REPORT_HEADING = "## Dirigent Stats";
const AGENT_HEADER = "| Agent | Model | Runs | Usage | Share |";
const AGENT_SEPARATOR = "| --- | --- | ---: | ---: | ---: |";
const MODEL_HEADER = "| Model | Runs | Usage | Share |";
const MODEL_SEPARATOR = "| --- | ---: | ---: | ---: |";
const USAGE = String.raw`(?:0|[1-9]\d{0,2}(?:,\d{3})*)(?:\.\d{1,3})? kToks`;
const AGENT_ROW = new RegExp(String.raw`^\| [^|\n]+ \| [^|\n]* \| \d+ \| ${USAGE} \| \d+\.\d% \|$`);
const MODEL_ROW = new RegExp(String.raw`^\| [^|\n]+ \| \d+ \| ${USAGE} \| \d+\.\d% \|$`);

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

function eventState(event, sessionId) {
  const transcriptPath = typeof event.transcript_path === "string" && event.transcript_path
    ? path.resolve(event.transcript_path)
    : null;
  return {
    schema: STATE_SCHEMA,
    sessionId,
    transcriptPath,
    cwd: typeof event.cwd === "string" ? event.cwd : null,
    source: "stop",
  };
}

function legacyAnchorUsable(state, sessionId) {
  if (!state || state.schema !== 1 || typeof state.transcriptPath !== "string") return false;
  const transcript = path.resolve(state.transcriptPath);
  return path.basename(transcript, ".jsonl") === sessionId
    && validTranscriptSession(readJsonLines(transcript), sessionId);
}

function stopState(state, event, sessionId) {
  if (state && state.schema === STATE_SCHEMA) return state;
  if (legacyAnchorUsable(state, sessionId)) return state;
  // Stop payload belongs to this hook's session. Transcript validation later
  // prevents an event path from widening scope to another session.
  return eventState(event, sessionId);
}

function validReport(reportText, view) {
  if (typeof reportText !== "string") return false;
  if (reportText === NO_DATA) return true;
  if (/<!--|Snapshot:|Instruction:/.test(reportText)) return false;
  const lines = reportText.split("\n");
  if (lines[0] !== REPORT_HEADING || lines[1] !== "") return false;
  let index = 2;
  const table = (header, separator, rowPattern) => {
    if (lines[index] !== header || lines[index + 1] !== separator) return false;
    index += 2;
    const first = index;
    while (typeof lines[index] === "string" && rowPattern.test(lines[index])) index += 1;
    if (index === first || lines[index] !== "") return false;
    index += 1;
    return true;
  };
  if (view !== "models" && !table(AGENT_HEADER, AGENT_SEPARATOR, AGENT_ROW)) return false;
  if (view !== "agents" && !table(MODEL_HEADER, MODEL_SEPARATOR, MODEL_ROW)) return false;
  if (!new RegExp(String.raw`^Exact known total: ${USAGE}\.$`).test(lines[index])) return false;
  index += 1;
  if (lines[index] === "Warnings:") {
    index += 1;
    const first = index;
    while (typeof lines[index] === "string" && lines[index].startsWith("- ")) index += 1;
    if (index === first) return false;
  }
  return index === lines.length;
}

function usageTokens(usage) {
  const match = /^((?:0|[1-9]\d{0,2}(?:,\d{3})*))(?:\.(\d{1,3}))? kToks$/.exec(usage);
  if (!match) return null;
  const whole = Number(match[1].replace(/,/g, ""));
  const fraction = Number((match[2] || "").padEnd(3, "0"));
  const tokens = (whole * 1000) + fraction;
  return Number.isSafeInteger(tokens) ? tokens : null;
}

function validReports(reports) {
  if (!reports || typeof reports !== "object") return false;
  const zero = VIEWS.map((view) => reports[view] === NO_DATA);
  if (zero.some(Boolean)) return zero.every(Boolean);
  if (!VIEWS.every((view) => validReport(reports[view], view))) return false;
  const parts = (report) => {
    const lines = report.split("\n");
    const table = (header, usageCell) => {
      const start = lines.indexOf(header);
      if (start < 0) return { text: null, tokens: null };
      const end = lines.indexOf("", start);
      let tokens = 0;
      for (const row of lines.slice(start + 2, end)) {
        const cells = row.slice(1, -1).split("|").map((cell) => cell.trim());
        const rowTokens = usageTokens(cells[usageCell]);
        if (rowTokens === null || tokens > Number.MAX_SAFE_INTEGER - rowTokens) return null;
        tokens += rowTokens;
      }
      return { text: lines.slice(start, end).join("\n"), tokens };
    };
    const agent = table(AGENT_HEADER, 3);
    const model = table(MODEL_HEADER, 2);
    const totalLine = lines.find((line) => line.startsWith("Exact known total: "));
    const total = totalLine && usageTokens(totalLine.slice("Exact known total: ".length, -1));
    const warningStart = lines.indexOf("Warnings:");
    return agent && model && total !== null ? {
      agent,
      model,
      total,
      warnings: warningStart < 0 ? "" : lines.slice(warningStart).join("\n"),
    } : null;
  };
  const both = parts(reports.both);
  const agents = parts(reports.agents);
  const models = parts(reports.models);
  const arithmeticMatches = (report) => report
    && [report.agent, report.model].every((table) => table.tokens === null || table.tokens === report.total);
  return arithmeticMatches(both) && arithmeticMatches(agents) && arithmeticMatches(models)
    && both.total === agents.total && both.total === models.total
    && both.warnings === agents.warnings && both.warnings === models.warnings
    && both.agent.text === agents.agent.text && both.model.text === models.model.text;
}

function validCache(cache, state, sessionId) {
  return state && state.schema === STATE_SCHEMA && cache && cache.schema === CACHE_SCHEMA
    && cache.sessionId === sessionId && cache.transcriptPath === state.transcriptPath
    && validReports(cache.reports);
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
  const children = descendants.flatMap((file) => {
    const records = readJsonLines(file);
    const sessionId = records.map(recordSessionId).find((id) => typeof id === "string" && id);
    return typeof sessionId === "string" && validTranscriptSession(records, sessionId) ? [{ file, sessionId }] : [];
  });
  return [{ file: root, sessionId: rootSessionId }, ...children].sort((left, right) => left.file.localeCompare(right.file));
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

function formatUsage(tokens) {
  const whole = Math.floor(tokens / 1000).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const remainder = Math.trunc(tokens % 1000);
  const fraction = remainder ? `.${String(remainder).padStart(3, "0").replace(/0+$/, "")}` : "";
  return `${whole}${fraction} kToks`;
}

function markdown(rows, total) {
  if (total === 0) return { both: NO_DATA, agents: NO_DATA, models: NO_DATA };
  const share = (value) => total ? `${((value / total) * 100).toFixed(1)}%` : "unknown";
  const agentRows = [...rows.agents.values()]
    .sort((a, b) => (a.role === "orchestrator" ? -1 : b.role === "orchestrator" ? 1 : b.tokens - a.tokens || a.role.localeCompare(b.role)))
    .map((row) => `| ${row.role} | ${[...row.models].sort().join(", ") || "unknown"} | ${row.runs.size} | ${formatUsage(row.tokens)} | ${share(row.tokens)} |`);
  const modelRows = [...rows.models.values()]
    .sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model))
    .map((row) => `| ${row.model} | ${row.runs.size} | ${formatUsage(row.tokens)} | ${share(row.tokens)} |`);
  const render = (view) => {
    const lines = [REPORT_HEADING, ""];
    if (view !== "models") lines.push(AGENT_HEADER, AGENT_SEPARATOR, ...agentRows, "");
    if (view !== "agents") lines.push(MODEL_HEADER, MODEL_SEPARATOR, ...modelRows, "");
    lines.push(`Exact known total: ${formatUsage(total)}.`);
    if (rows.warnings.length) lines.push("Warnings:", ...rows.warnings.sort().map((warning) => `- ${warning}`));
    return lines.join("\n");
  };
  return Object.fromEntries(VIEWS.map((view) => [view, render(view)]));
}

function noDataReport() {
  return { both: NO_DATA, agents: NO_DATA, models: NO_DATA };
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
  const latestByIdentity = new Map();
  for (const current of files) {
    if (expired(deadline)) return noDataReport();
    const { file, sessionId: transcriptSessionId } = current;
    const records = readJsonLines(file);
    const transcriptAgentId = records.map(agentId).find(Boolean);
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
      const recordSession = recordSessionId(record) || transcriptSessionId;
      const key = `${recordSession}\0${messageId}`;
      const candidate = {
        file,
        id: agentId(record) || transcriptAgentId,
        model: modelName(record),
        tokens: usage,
        root: path.resolve(file) === path.resolve(transcript),
      };
      const previous = latestByIdentity.get(key);
      const candidateIdentity = `${candidate.id || ""}\0${candidate.model}`;
      const previousIdentity = previous && `${previous.id || ""}\0${previous.model}`;
      if (!previous
        || candidate.tokens > previous.tokens
        || (candidate.tokens === previous.tokens && candidate.root && !previous.root)
        || (candidate.tokens === previous.tokens && candidate.root === previous.root
          && candidateIdentity < previousIdentity)) {
        latestByIdentity.set(key, candidate);
      }
    }
  }
  const entries = [...latestByIdentity.values()];
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

function cacheReport(state, sessionId, reports) {
  if (!state) return;
  const next = {
    schema: STATE_SCHEMA,
    sessionId,
    transcriptPath: state.transcriptPath,
    cwd: typeof state.cwd === "string" ? state.cwd : null,
    source: typeof state.source === "string" ? state.source : "unknown",
    cache: { schema: CACHE_SCHEMA, sessionId, transcriptPath: state.transcriptPath, reports, report: reports.both, createdAt: new Date().toISOString() },
  };
  atomicStateWrite(stateFile(sessionId), next);
}

function requestedEvent(event) {
  const eventName = typeof event.hook_event_name === "string" ? event.hook_event_name
    : typeof event.hookEventName === "string" ? event.hookEventName : null;
  if (eventName === "UserPromptExpansion") {
    return event.expansion_type === "slash_command" && EXPANSION_COMMANDS.has(event.command_name)
      ? eventName : null;
  }
  if (eventName && eventName !== "UserPromptSubmit") return null;
  const prompt = typeof event.prompt === "string" ? event.prompt : typeof event.user_prompt === "string" ? event.user_prompt : "";
  if (eventName === "UserPromptSubmit" && DIRECT_SLASH_REQUEST.test(prompt.trimStart())) return null;
  return REQUEST.test(prompt) ? eventName || "UserPromptSubmit" : null;
}

function requestedView(event, hookEventName) {
  const text = hookEventName === "UserPromptExpansion"
    ? event.command_args
    : typeof event.prompt === "string" ? event.prompt : typeof event.user_prompt === "string" ? event.user_prompt : "";
  const tokens = typeof text === "string" ? text.trim().split(/\s+/).filter(Boolean) : [];
  const positions = tokens.flatMap((token, index) => token === "--view" ? [index] : []);
  if (positions.length === 0) return "both";
  if (positions.length !== 1) return null;
  const value = tokens[positions[0] + 1];
  return VIEWS.includes(value) ? value : null;
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
      const anchor = stopState(state, event, sessionId);
      cacheReport(anchor, sessionId, buildReport(anchor, sessionId, deadline));
      return;
    }
    const hookEventName = requestedEvent(event);
    if (!hookEventName) return;
    const view = requestedView(event, hookEventName);
    if (!view) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: INVALID_VIEW } }) + "\n");
      return;
    }
    const reports = validCache(state && state.cache, state, sessionId)
      ? state.cache.reports
      : buildReport(state, sessionId, deadline);
    // Legacy, missing, and corrupt cache recover once from anchored data. Keep
    // prompt response deterministic even when no completed transcript exists.
    if (!validCache(state && state.cache, state, sessionId)) cacheReport(state, sessionId, reports);
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: reports[view] } }) + "\n");
  } catch {
    // Never block prompt submission.
  }
});
