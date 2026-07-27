#!/usr/bin/env node
// SessionStart creates the root-only cache. Resume preserves completed runs.
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SOURCES = new Set(["startup", "resume", "clear", "compact"]);
const SCHEMA = 3;

function safeId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && !value.includes("\0") ? value : null;
}

function stateDir() {
  return process.env.DIRIGENT_STATS_STATE_DIR || path.join(process.env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), ".claude"), "dirigent-stats");
}

function stateFile(sessionId) {
  return path.join(stateDir(), `${crypto.createHash("sha256").update(sessionId).digest("hex")}.json`);
}

function validState(state, sessionId) {
  return state && state.schema === SCHEMA && state.rootSessionId === sessionId
    && (state.rootTranscriptPath === null || typeof state.rootTranscriptPath === "string")
    && state.runs && typeof state.runs === "object" && !Array.isArray(state.runs)
    && (state.agentRoles === undefined || (state.agentRoles && typeof state.agentRoles === "object"
      && !Array.isArray(state.agentRoles) && Object.entries(state.agentRoles)
        .every(([id, role]) => safeId(id) && typeof role === "string" && role)));
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
  const suppliedPath = typeof event.transcript_path === "string" && event.transcript_path ? path.resolve(event.transcript_path) : null;
  try {
    fs.mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
    const file = stateFile(sessionId);
    let previous = null;
    try { previous = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* Fresh state. */ }
    // Only a valid v3 resume/compact cache survives. Old schemas deliberately
    // receive no migration or historical recovery.
    if ((event.source === "resume" || event.source === "compact") && validState(previous, sessionId)) {
      if (suppliedPath && previous.rootTranscriptPath !== suppliedPath) {
        atomicWrite(file, { ...previous, rootTranscriptPath: suppliedPath });
      }
      return;
    }
    atomicWrite(file, {
      schema: SCHEMA,
      rootSessionId: sessionId,
      rootTranscriptPath: suppliedPath,
      runs: {},
    });
  } catch { /* SessionStart must never block. */ }
}

main().catch(() => {});
