#!/usr/bin/env node
// SessionStart hook: persist a per-session, provider-local stats anchor.
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SOURCES = new Set(["startup", "resume", "clear", "compact"]);
const SCHEMA = 2;
const NO_DATA = "No token usage available yet.";
const REPORT_HEADING = "## Dirigent Stats";
const AGENT_HEADER = "| Agent | Model | Runs | Tokens | Share |";
const AGENT_SEPARATOR = "| --- | --- | ---: | ---: | ---: |";
const MODEL_HEADER = "| Model | Runs | Tokens | Share |";
const MODEL_SEPARATOR = "| --- | ---: | ---: | ---: |";
const AGENT_ROW = /^\| [^|\n]+ \| [^|\n]* \| \d+ \| \d+ \| \d+\.\d% \|$/;
const MODEL_ROW = /^\| [^|\n]+ \| \d+ \| \d+ \| \d+\.\d% \|$/;

function safeId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && !value.includes("\0") ? value : null;
}

function stateFile(dir, sessionId) {
  return path.join(dir, `${crypto.createHash("sha256").update(sessionId).digest("hex")}.json`);
}

function cleanupTemporary(file) {
  if (!file) return;
  try { fs.unlinkSync(file); } catch (error) {
    if (error && error.code === "ENOENT") return;
    // SessionStart must fail open, including cleanup failures.
  }
}

function validReport(reportText) {
  if (typeof reportText !== "string") return false;
  if (reportText === NO_DATA) return true;
  if (/<!--|Snapshot:|Instruction:/.test(reportText)) return false;
  const lines = reportText.split("\n");
  if (lines[0] !== REPORT_HEADING || lines[1] !== ""
      || lines[2] !== AGENT_HEADER || lines[3] !== AGENT_SEPARATOR) return false;
  const agentEnd = lines.indexOf("", 4);
  if (agentEnd <= 4 || !lines.slice(4, agentEnd).every((line) => AGENT_ROW.test(line))
      || lines[agentEnd + 1] !== MODEL_HEADER || lines[agentEnd + 2] !== MODEL_SEPARATOR) return false;
  const modelEnd = lines.indexOf("", agentEnd + 3);
  if (modelEnd <= agentEnd + 3 || !lines.slice(agentEnd + 3, modelEnd).every((line) => MODEL_ROW.test(line))
      || !/^Exact known total: [1-9]\d* tokens\.$/.test(lines[modelEnd + 1])) return false;
  let index = modelEnd + 2;
  if (lines[index] === "Warnings:") {
    index += 1;
    const firstWarning = index;
    while (typeof lines[index] === "string" && lines[index].startsWith("- ")) index += 1;
    if (index === firstWarning) return false;
  }
  return index === lines.length;
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
  const stateDir = process.env.DIRIGENT_STATS_STATE_DIR || path.join(process.env.PLUGIN_DATA || path.join(os.homedir(), ".codex"), "dirigent-stats");
  const suppliedTranscriptPath = typeof event.transcript_path === "string" && event.transcript_path ? path.resolve(event.transcript_path) : null;
  let temporary = null;
  try {
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const file = stateFile(stateDir, sessionId);
    // A resume/compact must not discard Stop's report while hooks race.
    let existing = null;
    try { existing = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* fresh state */ }
    const existingAnchor = existing && (existing.schema === 1 || existing.schema === SCHEMA)
      && existing.sessionId === sessionId
      && (existing.transcriptPath === null || typeof existing.transcriptPath === "string") ? existing : null;
    const preserveAnchor = event.source === "resume" || event.source === "compact";
    const transcriptPath = suppliedTranscriptPath || (preserveAnchor && existingAnchor ? existingAnchor.transcriptPath : null);
    const cache = existingAnchor && existingAnchor.schema === SCHEMA
      && existingAnchor.cache && existingAnchor.cache.sessionId === sessionId
      && existingAnchor.cache.transcriptPath === transcriptPath
      && validReport(existingAnchor.cache.report) ? existingAnchor.cache : null;
    const state = {
      schema: SCHEMA,
      sessionId,
      transcriptPath,
      cwd: typeof event.cwd === "string" ? event.cwd : null,
      source: event.source,
      ...(cache ? { cache } : {}),
    };
    temporary = path.join(stateDir, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`);
    fs.writeFileSync(temporary, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, file);
  } catch { /* SessionStart must never block. */ } finally { cleanupTemporary(temporary); }
}

main().catch(() => {});
