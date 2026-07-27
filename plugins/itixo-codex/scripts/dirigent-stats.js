#!/usr/bin/env node
// Cache-only Codex stats. Lifecycle hooks append latest cumulative totals.
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SCHEMA = 3;
const NO_DATA = "No token usage available yet.";
const INVALID_VIEW = "Invalid stats view. Use agents, models, or both.";
const INVOCATION = /(^|\s)(?:\/|\$)(?:dirigent-stats|itixo-codex:dirigent-stats)(?=$|\s|[.,!?;:](?=$|\s))/;
const VIEWS = ["both", "agents", "models"];
const MAX_READ_BYTES = 256 * 1024;

function safeString(value) {
  return typeof value === "string" && value && value.length <= 4096 && !value.includes("\0") ? value : null;
}

function stateDir() {
  return process.env.DIRIGENT_STATS_STATE_DIR || path.join(process.env.PLUGIN_DATA || path.join(os.homedir(), ".codex"), "dirigent-stats");
}

function stateFile(sessionId) {
  return path.join(stateDir(), `${crypto.createHash("sha256").update(sessionId).digest("hex")}.json`);
}

function validRun(run) {
  return run && typeof run === "object" && typeof run.role === "string" && run.role
    && run.provider === "Codex" && typeof run.model === "string" && run.model
    && Number.isSafeInteger(run.offset) && run.offset >= 0
    && (run.tokens === null || (Number.isSafeInteger(run.tokens) && run.tokens >= 0));
}

function readCache(sessionId) {
  try {
    const cache = JSON.parse(fs.readFileSync(stateFile(sessionId), "utf8"));
    if (cache.schema !== SCHEMA || cache.rootSessionId !== sessionId || !cache.runs
      || typeof cache.runs !== "object" || Array.isArray(cache.runs)
      || !Object.values(cache.runs).every(validRun)) return null;
    return cache;
  } catch { return null; }
}

function writeCache(sessionId, cache) {
  const file = stateFile(sessionId);
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(temp, JSON.stringify(cache), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temp, file);
    return true;
  } catch {
    return false;
  } finally {
    try { fs.unlinkSync(temp); } catch { /* already renamed */ }
  }
}

function reclaimDeadLock(lock) {
  let owner;
  try {
    owner = JSON.parse(fs.readFileSync(lock, "utf8"));
  } catch { /* malformed/incomplete lock has no owner to protect */ }
  if (owner && Number.isSafeInteger(owner.pid) && owner.pid > 0 && safeString(owner.token)) {
    try {
      process.kill(owner.pid, 0);
      return false;
    } catch (error) {
      if (!error || error.code !== "ESRCH") return false;
    }
  }
  const reclaimed = `${lock}.stale.${process.pid}.${crypto.randomBytes(8).toString("hex")}`;
  try {
    // Rename claims old lock before deletion; old owner cannot release a new one.
    fs.renameSync(lock, reclaimed);
    fs.unlinkSync(reclaimed);
    return true;
  } catch { return false; }
}

function withCacheLock(sessionId, action) {
  const file = stateFile(sessionId);
  const lock = `${file}.lock`;
  let token = null;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    for (;;) {
      const candidate = `${lock}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
      try {
        token = crypto.randomBytes(16).toString("hex");
        fs.writeFileSync(candidate, JSON.stringify({ pid: process.pid, token }), { encoding: "utf8", mode: 0o600, flag: "wx" });
        fs.linkSync(candidate, lock);
        return action();
      } catch (error) {
        if (!error || error.code !== "EEXIST") return null;
        if (reclaimDeadLock(lock)) continue;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      } finally {
        try { fs.unlinkSync(candidate); } catch { /* candidate already removed */ }
      }
    }
  } finally {
    if (token !== null) {
      try {
        if (JSON.parse(fs.readFileSync(lock, "utf8")).token === token) fs.unlinkSync(lock);
      } catch { /* lock reclaimed or released */ }
    }
  }
}

function input() {
  return new Promise((resolve) => {
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { text += chunk; });
    process.stdin.on("end", () => resolve(text));
    process.stdin.on("error", () => resolve(""));
  });
}

function totalTokens(record) {
  const payload = record && record.payload;
  if (!record || record.type !== "event_msg" || !payload || payload.type !== "token_count") return null;
  const total = payload.info && payload.info.total_token_usage && payload.info.total_token_usage.total_tokens;
  return Number.isSafeInteger(total) && total >= 0 ? total : null;
}

// Read only newly appended bytes. On first observation, tail a bounded window;
// token_count is cumulative, so latest complete snapshot is sufficient.
function latestTokenSnapshot(transcriptPath, offset) {
  let stat;
  try { stat = fs.statSync(transcriptPath); } catch { return null; }
  if (!stat.isFile()) return null;
  if (stat.size < offset) return { offset: 0, tokens: null, invalid: true };
  const start = offset === 0 ? Math.max(0, stat.size - MAX_READ_BYTES) : offset;
  const length = Math.min(MAX_READ_BYTES, stat.size - start);
  if (length === 0) return { offset: stat.size, tokens: null };
  let text;
  try {
    const fd = fs.openSync(transcriptPath, "r");
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    fs.closeSync(fd);
    text = buffer.toString("utf8");
  } catch { return null; }
  const atEnd = start + length === stat.size;
  const newline = text.lastIndexOf("\n");
  const complete = newline < 0 ? "" : text.slice(0, newline + 1);
  let consumed = complete ? Buffer.byteLength(complete, "utf8") : 0;
  let latest = null;
  const parse = (line) => {
    try {
      const value = totalTokens(JSON.parse(line));
      if (value !== null) latest = value;
      return true;
    } catch { return false; }
  };
  for (const line of complete.split("\n")) parse(line);
  const trailing = text.slice(newline + 1);
  // An EOF line may be a complete JSONL record without its final newline.
  if (atEnd && trailing && parse(trailing)) {
    consumed = length;
  }
  // Never skip bytes beyond a complete JSONL record when a capped read ends.
  return { offset: start + consumed, tokens: latest };
}

function role(event, root) {
  if (root) return "orchestrator";
  return safeString(event.agent_type) || safeString(event.agent_role) || "unknown";
}

function model(event, knownRole) {
  return safeString(event.model) || (knownRole ? "<assumed>" : "unknown");
}

function updateRun(event, root) {
  const rootSessionId = safeString(event && (event.session_id || event.thread_id));
  if (!rootSessionId) return;
  const agentId = root ? rootSessionId : safeString(event.agent_id);
  const transcriptPath = root ? safeString(event.transcript_path) : safeString(event.agent_transcript_path);
  if (!agentId || !transcriptPath) return;
  for (;;) {
    const observed = readCache(rootSessionId);
    if (!observed) return; // Old/malformed cache is unavailable; never rebuild it.
    const prior = observed.runs[agentId];
    const priorOffset = prior && validRun(prior) ? prior.offset : 0;
    const snapshot = latestTokenSnapshot(path.resolve(transcriptPath), priorOffset);
    if (!snapshot) return;
    const fallbackRole = role(event, root);
    const fallbackModel = model(event, fallbackRole !== "unknown");
    const result = withCacheLock(rootSessionId, () => {
      const cache = readCache(rootSessionId);
      if (!cache) return "done";
      const current = cache.runs[agentId];
      if ((current && validRun(current) ? current.offset : 0) !== priorOffset) return "retry";
      const run = current && validRun(current) ? current : { role: fallbackRole, model: fallbackModel, tokens: null };
      cache.runs[agentId] = {
        role: run.role,
        provider: "Codex",
        model: run.model,
        offset: snapshot.offset,
        // A reset/truncated transcript invalidates its earlier cumulative total.
        tokens: snapshot.invalid ? null : (snapshot.tokens === null ? run.tokens : snapshot.tokens),
      };
      return writeCache(rootSessionId, cache) ? "done" : "failed";
    });
    if (result !== "retry") return;
  }
}

function recordSubagentMetadata(event) {
  const rootSessionId = safeString(event && (event.session_id || event.thread_id));
  const agentId = safeString(event && event.agent_id);
  if (!rootSessionId || !agentId) return;
  const runRole = role(event, false);
  const run = { role: runRole, provider: "Codex", model: model(event, runRole !== "unknown"), offset: 0, tokens: null };
  for (;;) {
    const result = withCacheLock(rootSessionId, () => {
      const cache = readCache(rootSessionId);
      if (!cache || cache.runs[agentId]) return "done";
      cache.runs[agentId] = run;
      return writeCache(rootSessionId, cache) ? "done" : "failed";
    });
    if (result !== "retry") return;
  }
}

function formatUsage(tokens) {
  const whole = Math.floor(tokens / 1000).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const remainder = tokens % 1000;
  return `${whole}${remainder ? `.${String(remainder).padStart(3, "0").replace(/0+$/, "")}` : ""} kToks`;
}

function render(cache) {
  const runs = Object.values(cache.runs).filter((run) => run.tokens !== null && run.tokens > 0);
  const total = runs.reduce((sum, run) => sum + run.tokens, 0);
  if (!total) return Object.fromEntries(VIEWS.map((view) => [view, NO_DATA]));
  const agents = new Map();
  const models = new Map();
  for (const run of runs) {
    const agent = agents.get(run.role) || { tokens: 0, runs: 0, models: new Set() };
    agent.tokens += run.tokens; agent.runs += 1; agent.models.add(run.model); agents.set(run.role, agent);
    const byModel = models.get(run.model) || { tokens: 0, runs: 0 };
    byModel.tokens += run.tokens; byModel.runs += 1; models.set(run.model, byModel);
  }
  const share = (tokens) => `${(tokens * 100 / total).toFixed(1)}%`;
  const agentRows = [...agents.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, item]) =>
    `| ${name} | ${[...item.models].sort().join(", ")} | ${item.runs} | ${formatUsage(item.tokens)} | ${share(item.tokens)} |`);
  const modelRows = [...models.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, item]) =>
    `| ${name} | ${item.runs} | ${formatUsage(item.tokens)} | ${share(item.tokens)} |`);
  const make = (view) => ["## Dirigent Stats", "",
    ...(view === "models" ? [] : ["| Agent | Model | Runs | Usage | Share |", "| --- | --- | ---: | ---: | ---: |", ...agentRows, ""]),
    ...(view === "agents" ? [] : ["| Model | Runs | Usage | Share |", "| --- | ---: | ---: | ---: |", ...modelRows, ""]),
    `Exact known total: ${formatUsage(total)}.`].join("\n");
  return Object.fromEntries(VIEWS.map((view) => [view, make(view)]));
}

function requestedView(text) {
  const values = String(text).trim().split(/\s+/);
  const index = values.indexOf("--view");
  return index < 0 ? "both" : (values.filter((value) => value === "--view").length === 1 && VIEWS.includes(values[index + 1]) ? values[index + 1] : null);
}

async function main() {
  let event;
  try { event = JSON.parse(await input()); } catch { return; }
  const name = event && (event.hook_event_name || event.hookEventName);
  if (name === "SubagentStart") return recordSubagentMetadata(event);
  if (name === "SubagentStop") return updateRun(event, false);
  if (name === "SessionEnd") return updateRun(event, true);
  const prompt = event && (event.prompt || event.user_prompt || event.message || "");
  if (!INVOCATION.test(prompt)) return;
  const sessionId = safeString(event && (event.session_id || event.thread_id));
  const view = requestedView(prompt);
  if (!view) return process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: INVALID_VIEW } }));
  const cache = sessionId && readCache(sessionId);
  const reports = cache ? render(cache) : Object.fromEntries(VIEWS.map((entry) => [entry, NO_DATA]));
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: reports[view] } }));
}

main().catch(() => {});
