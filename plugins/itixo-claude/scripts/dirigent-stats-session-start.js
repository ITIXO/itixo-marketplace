#!/usr/bin/env node
// SessionStart hook: persist a per-session, provider-local stats anchor.
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SOURCES = new Set(["startup", "resume", "clear", "compact"]);
const SCHEMA = 1;

function safeId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && !value.includes("\0") ? value : null;
}

function stateFile(dir, sessionId) {
  return path.join(dir, `${crypto.createHash("sha256").update(sessionId).digest("hex")}.json`);
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
  const transcriptPath = typeof event.transcript_path === "string" && event.transcript_path ? path.resolve(event.transcript_path) : null;
  const state = { schema: SCHEMA, sessionId, transcriptPath, cwd: typeof event.cwd === "string" ? event.cwd : null, source: event.source };
  try {
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const file = stateFile(stateDir, sessionId);
    const temporary = path.join(stateDir, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`);
    fs.writeFileSync(temporary, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, file);
  } catch { /* SessionStart must never block. */ }
}

main().catch(() => {});
