#!/usr/bin/env node
// Prompt hooks read the cache only. Lifecycle hooks update one run at a time.
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REQUEST = /(?:^|\s)[/$](?:dirigent-stats|itixo-claude:dirigent-stats)(?=$|\s|[.,!?;:](?=$|\s))/;
const DIRECT_SLASH_REQUEST = /^\/(?:dirigent-stats|itixo-claude:dirigent-stats)(?=$|\s)/;
const EXPANSION_COMMANDS = new Set(["dirigent-stats", "itixo-claude:dirigent-stats"]);
const USAGE_FIELDS = ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"];
const SCHEMA = 3;
const NO_DATA = "No token usage available yet.";
const INVALID_VIEW = "Invalid stats view. Use agents, models, or both.";
const VIEWS = ["both", "agents", "models"];
const REPORT_HEADING = "## Dirigent Stats";
const AGENT_HEADER = "| Agent | Model | Runs | Usage | Share |";
const AGENT_SEPARATOR = "| --- | --- | ---: | ---: | ---: |";
const MODEL_HEADER = "| Model | Runs | Usage | Share |";
const MODEL_SEPARATOR = "| --- | ---: | ---: | ---: |";
const READ_CHUNK_BYTES = 64 * 1024;
const MAX_TAIL_BYTES = 4 * 1024 * 1024;
const INCOMPLETE_LOCK_GRACE_MS = 100;

function stateDir() {
  return process.env.DIRIGENT_STATS_STATE_DIR || path.join(process.env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), ".claude"), "dirigent-stats");
}

function stateFile(sessionId) {
  return path.join(stateDir(), `${crypto.createHash("sha256").update(sessionId).digest("hex")}.json`);
}

function safeId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && !value.includes("\0") ? value : null;
}

function validRun(run, id) {
  return run && run.agentId === id && typeof run.role === "string" && run.role
    && run.provider === "Claude" && typeof run.model === "string" && run.model
    && Number.isSafeInteger(run.byteOffset) && run.byteOffset >= 0
    && Number.isSafeInteger(run.tokens) && run.tokens > 0;
}

function validState(state, sessionId) {
  return state && state.schema === SCHEMA && state.rootSessionId === sessionId
    && (state.rootTranscriptPath === null || typeof state.rootTranscriptPath === "string")
    && state.runs && typeof state.runs === "object" && !Array.isArray(state.runs)
    && (state.agentRoles === undefined || (state.agentRoles && typeof state.agentRoles === "object"
      && !Array.isArray(state.agentRoles) && Object.entries(state.agentRoles)
        .every(([id, role]) => safeId(id) && typeof role === "string" && role)))
    && Object.entries(state.runs).every(([id, run]) => safeId(id) && validRun(run, id));
}

function readState(sessionId) {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile(sessionId), "utf8"));
    return validState(state, sessionId) ? state : null;
  } catch { return null; }
}

function atomicWrite(sessionId, state) {
  const directory = stateDir();
  const file = stateFile(sessionId);
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

function withStateLock(sessionId, work) {
  const directory = stateDir();
  const lock = `${stateFile(sessionId)}.lock`;
  const owner = crypto.randomBytes(16).toString("hex");
  let ownsLock = false;
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    while (!ownsLock) {
      try {
        fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, owner, createdAt: Date.now() }), {
          encoding: "utf8", mode: 0o600, flag: "wx",
        });
        ownsLock = true;
        break;
      } catch (error) {
        if (!error || error.code !== "EEXIST") return;
        // Never steal an old live lock: a paused owner can resume and write.
        // Only incomplete ownership or a proven-dead owner is reclaimable.
        try {
          let lockState = null;
          try { lockState = JSON.parse(fs.readFileSync(lock, "utf8")); } catch { /* Incomplete owner. */ }
          const incomplete = !lockState || !Number.isSafeInteger(lockState.pid) || lockState.pid <= 0
            || typeof lockState.owner !== "string" || !lockState.owner;
          let dead = false;
          if (!incomplete) {
            try { process.kill(lockState.pid, 0); } catch (ownerError) { dead = Boolean(ownerError && ownerError.code === "ESRCH"); }
          }
          const oldEnough = incomplete && Date.now() - fs.statSync(lock).mtimeMs > INCOMPLETE_LOCK_GRACE_MS;
          if (oldEnough || dead) {
            const retired = `${lock}.stale.${process.pid}.${crypto.randomBytes(8).toString("hex")}`;
            fs.renameSync(lock, retired);
            fs.unlinkSync(retired);
            continue;
          }
        } catch { /* Owner released or changed lock; retry. */ }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    if (!ownsLock) return;
    work();
  } catch { /* Hooks must fail open. */ } finally {
    try {
      const lockState = JSON.parse(fs.readFileSync(lock, "utf8"));
      if (ownsLock && lockState.pid === process.pid && lockState.owner === owner) fs.unlinkSync(lock);
    } catch { /* Another owner replaced or removed lock. */ }
  }
}

function readTranscriptTail(file, offset) {
  let descriptor;
  try {
    descriptor = fs.openSync(file, "r");
    const size = fs.fstatSync(descriptor).size;
    if (!Number.isSafeInteger(size) || !Number.isSafeInteger(offset) || offset < 0) return null;
    if (size < offset) return { truncated: true };
    const remaining = size - offset;
    if (remaining > MAX_TAIL_BYTES) return null;
    const chunks = [];
    let position = offset;
    while (position < size) {
      const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, size - position));
      const bytes = fs.readSync(descriptor, buffer, 0, buffer.length, position);
      if (bytes <= 0) return null;
      chunks.push(bytes === buffer.length ? buffer : buffer.subarray(0, bytes));
      position += bytes;
    }
    return { text: Buffer.concat(chunks).toString("utf8"), byteOffset: size };
  } catch { return null; } finally {
    try { if (descriptor !== undefined) fs.closeSync(descriptor); } catch { /* Best effort. */ }
  }
}

function latestUsage(text, byteOffset) {
  if (typeof text !== "string" || !Number.isSafeInteger(byteOffset) || byteOffset < 0) return null;
  const messages = new Map();
  let model = null;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch { return null; }
    if (record.type !== "assistant" || !record.message || typeof record.message !== "object") continue;
    const messageId = typeof record.message.id === "string" && record.message.id ? record.message.id : null;
    if (!messageId) return null;
    const usage = record.message.usage;
    if (!usage || typeof usage !== "object") return null;
    let total = 0;
    for (const field of USAGE_FIELDS) {
      const value = usage[field];
      if (value === undefined) continue;
      if (!Number.isSafeInteger(value) || value < 0 || total > Number.MAX_SAFE_INTEGER - value) return null;
      total += value;
    }
    if (total <= 0) return null;
    messages.set(messageId, total);
    if (typeof record.message.model === "string" && record.message.model) model = record.message.model;
  }
  let tokens = 0;
  for (const value of messages.values()) {
    if (tokens > Number.MAX_SAFE_INTEGER - value) return null;
    tokens += value;
  }
  return tokens === 0 ? null : { tokens, model, byteOffset };
}

function updateRun(event, child) {
  const sessionId = safeId(event && event.session_id);
  const agent = child ? safeId(event && event.agent_id) : sessionId;
  if (!sessionId || !agent) return;
  // Parse outside the short state lock. If another root update advances its
  // offset before merge, retry from its new offset until this update is saved.
  for (;;) {
    const observed = readState(sessionId);
    if (!observed) return;
    const transcript = child ? event.agent_transcript_path : event.transcript_path || observed.rootTranscriptPath;
    if (typeof transcript !== "string" || !transcript) return;
    const previous = observed.runs[agent];
    const offset = child ? 0 : previous ? previous.byteOffset : 0;
    const tail = readTranscriptTail(path.resolve(transcript), offset);
    if (!tail) return;
    const usage = tail.truncated ? null : latestUsage(tail.text, tail.byteOffset);
    // Bad or absent token data is not a merge conflict. Stop fail-open rather
    // than retrying forever; prompt reads the existing no-data-safe cache.
    if (!tail.truncated && !usage) return;
    let saved = false;
    withStateLock(sessionId, () => {
      const state = readState(sessionId);
      if (!state) return;
      if (tail.truncated) {
        atomicWrite(sessionId, { ...state, runs: {} });
        saved = true;
        return;
      }
      const current = state.runs[agent];
      if (!child && (current ? current.byteOffset : 0) !== offset) return;
      const role = child ? (typeof event.agent_type === "string" && event.agent_type ? event.agent_type
        : (state.agentRoles && state.agentRoles[agent]) || "unknown") : "orchestrator";
      const model = usage.model || (role === "unknown" ? "unknown" : "<assumed>");
      const run = { agentId: agent, role, provider: "Claude", model, byteOffset: usage.byteOffset, tokens: usage.tokens };
      atomicWrite(sessionId, {
        ...state,
        ...(child ? {} : { rootTranscriptPath: path.resolve(transcript) }),
        runs: { ...state.runs, [agent]: run },
      });
      saved = true;
    });
    if (saved) return;
  }
}

function recordAgentRole(event) {
  const sessionId = safeId(event && event.session_id);
  const agent = safeId(event && event.agent_id);
  const role = event && typeof event.agent_type === "string" && event.agent_type ? event.agent_type : null;
  if (!sessionId || !agent || !role) return;
  withStateLock(sessionId, () => {
    const state = readState(sessionId);
    if (!state) return;
    atomicWrite(sessionId, { ...state, agentRoles: { ...(state.agentRoles || {}), [agent]: role } });
  });
}

function formatUsage(tokens) {
  const whole = Math.floor(tokens / 1000).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const remainder = tokens % 1000;
  const fraction = remainder ? `.${String(remainder).padStart(3, "0").replace(/0+$/, "")}` : "";
  return `${whole}${fraction} kToks`;
}

function reports(state, sessionId) {
  if (!validState(state, sessionId) || Object.keys(state.runs).length === 0) return Object.fromEntries(VIEWS.map((view) => [view, NO_DATA]));
  const runs = Object.values(state.runs);
  const total = runs.reduce((sum, run) => sum + run.tokens, 0);
  if (!Number.isSafeInteger(total) || total <= 0) return Object.fromEntries(VIEWS.map((view) => [view, NO_DATA]));
  const agents = new Map();
  const models = new Map();
  for (const run of runs) {
    const agent = agents.get(run.role) || { role: run.role, models: new Set(), runs: 0, tokens: 0 };
    agent.models.add(`${run.provider} ${run.model}`); agent.runs += 1; agent.tokens += run.tokens; agents.set(run.role, agent);
    const name = `${run.provider} ${run.model}`;
    const model = models.get(name) || { name, runs: 0, tokens: 0 };
    model.runs += 1; model.tokens += run.tokens; models.set(name, model);
  }
  const share = (tokens) => `${((tokens / total) * 100).toFixed(1)}%`;
  const agentRows = [...agents.values()].sort((a, b) => (a.role === "orchestrator" ? -1 : b.role === "orchestrator" ? 1 : b.tokens - a.tokens || a.role.localeCompare(b.role)))
    .map((row) => `| ${row.role} | ${[...row.models].sort().join(", ")} | ${row.runs} | ${formatUsage(row.tokens)} | ${share(row.tokens)} |`);
  const modelRows = [...models.values()].sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name))
    .map((row) => `| ${row.name} | ${row.runs} | ${formatUsage(row.tokens)} | ${share(row.tokens)} |`);
  const render = (view) => {
    const lines = [REPORT_HEADING, ""];
    if (view !== "models") lines.push(AGENT_HEADER, AGENT_SEPARATOR, ...agentRows, "");
    if (view !== "agents") lines.push(MODEL_HEADER, MODEL_SEPARATOR, ...modelRows, "");
    lines.push(`Exact known total: ${formatUsage(total)}.`);
    return lines.join("\n");
  };
  return Object.fromEntries(VIEWS.map((view) => [view, render(view)]));
}

function requestedEvent(event) {
  const name = typeof event.hook_event_name === "string" ? event.hook_event_name : event.hookEventName;
  if (name === "UserPromptExpansion") return event.expansion_type === "slash_command" && EXPANSION_COMMANDS.has(event.command_name) ? name : null;
  if (name && name !== "UserPromptSubmit") return null;
  const prompt = typeof event.prompt === "string" ? event.prompt : typeof event.user_prompt === "string" ? event.user_prompt : "";
  return name === "UserPromptSubmit" && DIRECT_SLASH_REQUEST.test(prompt.trimStart()) ? null : REQUEST.test(prompt) ? name || "UserPromptSubmit" : null;
}

function requestedView(event, name) {
  const text = name === "UserPromptExpansion" ? event.command_args : event.prompt || event.user_prompt || "";
  const tokens = typeof text === "string" ? text.trim().split(/\s+/).filter(Boolean) : [];
  const positions = tokens.flatMap((token, index) => token === "--view" ? [index] : []);
  return positions.length === 0 ? "both" : positions.length === 1 && VIEWS.includes(tokens[positions[0] + 1]) ? tokens[positions[0] + 1] : null;
}

let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    if (process.argv.includes("--subagent-start")) return recordAgentRole(event);
    if (process.argv.includes("--subagent-stop")) return updateRun(event, true);
    if (process.argv.includes("--session-end")) return updateRun(event, false);
    const sessionId = safeId(event.session_id);
    if (!sessionId) return;
    const name = requestedEvent(event);
    if (!name) return;
    const view = requestedView(event, name);
    const additionalContext = view ? reports(readState(sessionId), sessionId)[view] : INVALID_VIEW;
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: name, additionalContext } }) + "\n");
  } catch { /* Hooks must never block Claude. */ }
});
