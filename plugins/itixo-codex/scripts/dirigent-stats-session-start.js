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

function cleanupTemporary(file) {
  if (!file) return;
  try { fs.unlinkSync(file); } catch (error) {
    if (error && error.code === "ENOENT") return;
    // SessionStart must fail open, including cleanup failures.
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
      && typeof existingAnchor.cache.report === "string"
      && existingAnchor.cache.report.includes("<!-- dirigent-stats:begin -->")
      && existingAnchor.cache.report.includes("<!-- dirigent-stats:end -->") ? existingAnchor.cache : null;
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
