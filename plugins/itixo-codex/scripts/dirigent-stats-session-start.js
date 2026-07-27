#!/usr/bin/env node
// SessionStart: create (or preserve on resume) the root-only stats cache.
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SCHEMA = 3;
const SOURCES = new Set(["startup", "resume", "clear", "compact"]);

function safeString(value) {
  return typeof value === "string" && value && value.length <= 512 && !value.includes("\0") ? value : null;
}

function stateDir() {
  return process.env.DIRIGENT_STATS_STATE_DIR || path.join(process.env.PLUGIN_DATA || path.join(os.homedir(), ".codex"), "dirigent-stats");
}

function stateFile(sessionId) {
  return path.join(stateDir(), `${crypto.createHash("sha256").update(sessionId).digest("hex")}.json`);
}

function validCache(cache, sessionId) {
  return cache && cache.schema === SCHEMA && cache.rootSessionId === sessionId
    && cache.runs && typeof cache.runs === "object" && !Array.isArray(cache.runs);
}

function write(file, state) {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(temp, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temp, file);
  } finally {
    try { fs.unlinkSync(temp); } catch { /* already renamed */ }
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
  const sessionId = safeString(event && event.session_id);
  if (!sessionId) return;
  try {
    fs.mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
    const file = stateFile(sessionId);
    let existing = null;
    try { existing = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* new cache */ }
    // No schema migration. Resume/compact retain only an already-valid v3 cache.
    if ((event.source === "resume" || event.source === "compact") && validCache(existing, sessionId)) return;
    const rootModel = safeString(event && event.model) || "<assumed>";
    write(file, {
      schema: SCHEMA,
      rootSessionId: sessionId,
      runs: {
        [sessionId]: {
          role: "orchestrator", provider: "Codex", model: rootModel,
          offset: 0, tokens: null,
        },
      },
    });
  } catch { /* Hooks fail open. */ }
}

main().catch(() => {});
