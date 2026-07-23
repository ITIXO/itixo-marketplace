#!/usr/bin/env node
// SessionStart hook: persist a per-session, provider-local stats anchor.
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SOURCES = new Set(["startup", "resume", "clear", "compact"]);
const OMITTED_PATH_REUSE_SOURCES = new Set(["resume", "compact"]);
const SCHEMA = 2;
const CACHE_SCHEMA = 2;
const NO_DATA = "No token usage available yet.";
const VIEWS = ["both", "agents", "models"];
const REPORT_HEADING = "## Dirigent Stats";
const AGENT_HEADER = "| Agent | Model | Runs | Usage | Share |";
const AGENT_SEPARATOR = "| --- | --- | ---: | ---: | ---: |";
const MODEL_HEADER = "| Model | Runs | Usage | Share |";
const MODEL_SEPARATOR = "| --- | ---: | ---: | ---: |";
const USAGE = String.raw`(?:0|[1-9]\d{0,2}(?:,\d{3})*)(?:\.\d{1,3})? kToks`;
const AGENT_ROW = new RegExp(String.raw`^\| [^|\n]+ \| [^|\n]* \| \d+ \| ${USAGE} \| \d+\.\d% \|$`);
const MODEL_ROW = new RegExp(String.raw`^\| [^|\n]+ \| \d+ \| ${USAGE} \| \d+\.\d% \|$`);

function safeId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && !value.includes("\0") ? value : null;
}

function stateFile(dir, sessionId) {
  return path.join(dir, `${crypto.createHash("sha256").update(sessionId).digest("hex")}.json`);
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

function validCache(cache, sessionId, transcriptPath) {
  return cache && cache.schema === CACHE_SCHEMA && cache.sessionId === sessionId
    && cache.transcriptPath === transcriptPath && validReports(cache.reports);
}

function existingState(file, sessionId) {
  try {
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    return state && (state.schema === 1 || state.schema === SCHEMA) && state.sessionId === sessionId ? state : null;
  } catch { return null; }
}

function validAnchor(state, sessionId) {
  return Boolean(state) && (state.transcriptPath === null
    || (typeof state.transcriptPath === "string"
      && path.basename(path.resolve(state.transcriptPath), ".jsonl") === sessionId));
}

function atomicWrite(file, state) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`);
  try {
    fs.writeFileSync(temporary, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, file);
    fs.chmodSync(file, 0o600);
  } finally {
    try { fs.unlinkSync(temporary); } catch { /* Renamed or never created. */ }
  }
}

function input() {
  return new Promise((resolve) => {
    let value = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { value += chunk; });
    process.stdin.on("end", () => resolve(value));
    process.stdin.on("error", () => resolve(""));
  });
}

async function main() {
  let event;
  try { event = JSON.parse(await input()); } catch { return; }
  if (!SOURCES.has(event && event.source)) return;
  const sessionId = safeId(event && event.session_id);
  if (!sessionId) return;
  const stateDir = process.env.DIRIGENT_STATS_STATE_DIR || path.join(process.env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), ".claude"), "dirigent-stats");
  const requestedTranscriptPath = typeof event.transcript_path === "string" && event.transcript_path ? path.resolve(event.transcript_path) : null;
  try {
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const file = stateFile(stateDir, sessionId);
    const previous = existingState(file, sessionId);
    // Only continuity events may inherit an omitted anchor. Startup/clear must
    // discard pre-boundary totals when Claude supplies no fresh transcript.
    const reusePrevious = validAnchor(previous, sessionId)
      && (requestedTranscriptPath !== null || OMITTED_PATH_REUSE_SOURCES.has(event.source));
    const transcriptPath = requestedTranscriptPath !== null
      ? requestedTranscriptPath
      : reusePrevious && typeof previous.transcriptPath === "string" ? previous.transcriptPath : null;
    const cache = reusePrevious && validCache(previous.cache, sessionId, transcriptPath) ? previous.cache : undefined;
    const state = {
      schema: SCHEMA,
      sessionId,
      transcriptPath,
      cwd: typeof event.cwd === "string" ? event.cwd : reusePrevious ? previous.cwd || null : null,
      source: event.source,
      ...(cache ? { cache } : {}),
    };
    atomicWrite(file, state);
  } catch { /* SessionStart must never block. */ }
}

main().catch(() => {});
