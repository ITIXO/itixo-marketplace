#!/usr/bin/env node
// SessionStart hook: persist a per-session, provider-local stats anchor.
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SOURCES = new Set(["startup", "resume", "clear", "compact"]);
const SCHEMA = 2;

function safeId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && !value.includes("\0") ? value : null;
}

function stateFile(dir, sessionId) {
  return path.join(dir, `${crypto.createHash("sha256").update(sessionId).digest("hex")}.json`);
}

function validCache(cache, sessionId, transcriptPath) {
  return cache && cache.schema === 1 && cache.sessionId === sessionId
    && cache.transcriptPath === transcriptPath && typeof cache.report === "string";
}

function existingState(file, sessionId) {
  try {
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    return state && (state.schema === 1 || state.schema === SCHEMA) && state.sessionId === sessionId ? state : null;
  } catch { return null; }
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
    // Resume/compact events can omit a path. Keep their original anchor rather
    // than widening scope to an unrelated transcript lookup.
    const transcriptPath = requestedTranscriptPath || (previous && typeof previous.transcriptPath === "string" ? previous.transcriptPath : null);
    const cache = previous && validCache(previous.cache, sessionId, transcriptPath) ? previous.cache : undefined;
    const state = {
      schema: SCHEMA,
      sessionId,
      transcriptPath,
      cwd: typeof event.cwd === "string" ? event.cwd : previous?.cwd || null,
      source: event.source,
      ...(cache ? { cache } : {}),
    };
    atomicWrite(file, state);
  } catch { /* SessionStart must never block. */ }
}

main().catch(() => {});
