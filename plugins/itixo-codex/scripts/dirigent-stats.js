#!/usr/bin/env node

const fs = require("fs");
const crypto = require("crypto");
const os = require("os");
const path = require("path");
const INVOCATION = /(^|\s)(?:\/|\$)(?:dirigent-stats|itixo-codex:dirigent-stats)(?=$|\s|[.,!?;:](?=$|\s))/;
const STATE_SCHEMA = 2;
const CACHE_SCHEMA = 1;
const DEFAULT_STOP_BUDGET_MS = 1500;
const NO_DATA = "No token usage available yet.";
const REPORT_HEADING = "## Dirigent Stats";
const AGENT_HEADER = "| Agent | Model | Runs | Tokens | Share |";
const AGENT_SEPARATOR = "| --- | --- | ---: | ---: | ---: |";
const MODEL_HEADER = "| Model | Runs | Tokens | Share |";
const MODEL_SEPARATOR = "| --- | ---: | ---: | ---: |";
const AGENT_ROW = /^\| [^|\n]+ \| [^|\n]* \| \d+ \| \d+ \| \d+\.\d% \|$/;
const MODEL_ROW = /^\| [^|\n]+ \| \d+ \| \d+ \| \d+\.\d% \|$/;

function stopBudgetMs(raw) {
  if (raw === undefined) return DEFAULT_STOP_BUDGET_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_STOP_BUDGET_MS;
  return Math.min(5000, Math.max(100, Math.trunc(parsed)));
}

const STOP_BUDGET_MS = stopBudgetMs(process.env.DIRIGENT_STATS_STOP_BUDGET_MS);

function stateDir() {
  return process.env.DIRIGENT_STATS_STATE_DIR || path.join(process.env.PLUGIN_DATA || path.join(os.homedir(), ".codex"), "dirigent-stats");
}

function stateFile(sessionId) {
  const dir = stateDir();
  return path.join(dir, `${crypto.createHash("sha256").update(sessionId).digest("hex")}.json`);
}

function cleanupTemporary(file) {
  if (!file) return;
  try { fs.unlinkSync(file); } catch (error) {
    if (error && error.code === "ENOENT") return;
    // Stats hooks fail open, including cleanup failures.
  }
}

function sessionState(sessionId) {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile(sessionId), "utf8"));
    return state && (state.schema === 1 || state.schema === STATE_SCHEMA) && state.sessionId === sessionId
      && (state.transcriptPath === null || typeof state.transcriptPath === "string") ? state : null;
  } catch { return null; }
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

function cachedReport(state, sessionId) {
  const cache = state && state.schema === STATE_SCHEMA && state.cache;
  return cache && cache.schema === CACHE_SCHEMA && cache.sessionId === sessionId
    && cache.transcriptPath === state.transcriptPath && Number.isSafeInteger(cache.updatedAt) && cache.updatedAt >= 0
    && validReport(cache.report) ? cache.report : null;
}

function noData() {
  return NO_DATA;
}

function sameAnchor(left, right) {
  return Boolean(left && right && left.schema === right.schema && left.sessionId === right.sessionId
    && left.transcriptPath === right.transcriptPath && left.cwd === right.cwd && left.source === right.source);
}

function writeState(sessionId, anchor, reportText, turnId, resolvedTranscriptPath = null) {
  let temporary = null;
  try {
    const dir = stateDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = stateFile(sessionId);
    // Re-read immediately before write: preserve a newer SessionStart anchor.
    const current = sessionState(sessionId);
    const source = current || anchor || {};
    const mayApplyResolution = typeof resolvedTranscriptPath === "string"
      && (!current || current.transcriptPath === resolvedTranscriptPath || sameAnchor(current, anchor)
        || (current.transcriptPath === null && current.cache && current.cache.turnId === turnId));
    if (typeof resolvedTranscriptPath === "string" && !mayApplyResolution) return;
    const transcriptPath = mayApplyResolution
      ? resolvedTranscriptPath
      : source.transcriptPath === null || typeof source.transcriptPath === "string" ? source.transcriptPath : null;
    const state = {
      schema: STATE_SCHEMA,
      sessionId,
      transcriptPath,
      cwd: typeof source.cwd === "string" ? source.cwd : null,
      source: typeof source.source === "string" ? source.source : "stop",
      cache: { schema: CACHE_SCHEMA, sessionId, transcriptPath, report: reportText, updatedAt: Date.now(), ...(typeof turnId === "string" && turnId ? { turnId } : {}) },
    };
    temporary = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`);
    fs.writeFileSync(temporary, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, file);
  } catch { /* Hooks must fail open. */ } finally { cleanupTemporary(temporary); }
}

function stdin() {
  return new Promise((resolve) => {
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { text += chunk; });
    process.stdin.on("end", () => resolve(text));
    process.stdin.on("error", () => resolve(""));
  });
}

function numeric(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function at(object, keys) {
  let value = object;
  for (const key of keys) {
    if (!value || typeof value !== "object") return undefined;
    value = value[key];
  }
  return value;
}

function jsonlFiles(dir, result = [], deadline = Infinity) {
  if (Date.now() > deadline) return result;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return result; }
  for (let index = 0; index < entries.length; index += 1) {
    if (index % 32 === 0 && Date.now() > deadline) break;
    const entry = entries[index];
    const item = path.join(dir, entry.name);
    if (entry.isDirectory()) jsonlFiles(item, result, deadline);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) result.push(item);
  }
  return result;
}

function records(file, deadline = Infinity) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return null; }
  const result = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (index > 0 && index % 256 === 0 && Date.now() > deadline) return null;
    const line = lines[index];
    if (!line.trim()) continue;
    try { result.push(JSON.parse(line)); } catch { /* tolerate incomplete trailing JSONL */ }
  }
  return result;
}

function meta(items) {
  return items && items.find((item) => item && item.type === "session_meta");
}

function rolloutId(metaRecord) {
  const payload = metaRecord && metaRecord.payload;
  return payload && typeof payload.id === "string" ? payload.id : null;
}

function prioritizedFiles(files, deadline = Infinity) {
  const modified = new Map();
  for (let index = 0; index < files.length; index += 1) {
    if (index % 12 === 0 && Date.now() > deadline) break;
    const file = files[index];
    try { modified.set(file, fs.statSync(file).mtimeMs); } catch { modified.set(file, 0); }
  }
  return [...modified.keys()].sort((left, right) => modified.get(right) - modified.get(left) || left.localeCompare(right));
}

function resolveTranscript(event, files, deadline = Infinity) {
  if (typeof event.transcript_path === "string" && event.transcript_path) {
    const transcript = path.resolve(event.transcript_path);
    try { return fs.statSync(transcript).isFile() ? transcript : null; } catch { return null; }
  }
  const id = event.session_id || event.thread_id;
  if (typeof id !== "string" || !id) return null;
  const candidates = prioritizedFiles(files, deadline);
  for (let index = 0; index < candidates.length; index += 1) {
    if (index % 16 === 0 && Date.now() > deadline) return null;
    const file = candidates[index];
    const metadata = meta(records(file, deadline));
    if (rolloutId(metadata) === id) return file;
  }
  return null;
}

function parseRollout(file, deadline = Infinity) {
  const items = records(file, deadline);
  const metadata = meta(items);
  const id = rolloutId(metadata);
  if (!id) return null;
  const session = metadata.payload || {};
  const turns = new Map();
  const models = new Map();
  const warnings = new Set();
  let activeTurn = null;
  let previousCumulative = 0;
  let total = null;

  for (let index = 0; index < items.length; index += 1) {
    if (index > 0 && index % 256 === 0 && Date.now() > deadline) return null;
    const item = items[index];
    const payload = item && item.payload && typeof item.payload === "object" ? item.payload : {};
    if (item.type === "turn_context") {
      const id = payload.turn_id || payload.id || item.turn_id;
      if (typeof id === "string" && id) {
        activeTurn = id;
        turns.set(id, {
          model: typeof payload.model === "string" && payload.model ? payload.model : "unknown",
        });
      } else {
        activeTurn = null;
        warnings.add("A turn has no ID; its model usage is unavailable.");
      }
    }
    const cumulative = numeric(at(payload, ["info", "total_token_usage", "total_tokens"]));
    const latest = numeric(at(payload, ["info", "last_token_usage", "total_tokens"]));
    if (cumulative !== null) {
      total = cumulative;
      const delta = cumulative - previousCumulative;
      const turnId = payload.turn_id || at(payload, ["info", "turn_id"]) || item.turn_id || activeTurn;
      const turn = typeof turnId === "string" ? turns.get(turnId) : null;
      if (delta > 0) {
        if (turn) models.set(turn.model, (models.get(turn.model) || 0) + delta);
        else warnings.add("A token event has no matching turn; model usage is unavailable.");
        if (latest !== null && latest !== delta) {
          warnings.add("Incremental usage disagrees with cumulative delta; cumulative delta used.");
        }
      } else if (delta < 0) {
        models.clear();
        if (latest === cumulative && turn) {
          models.set(turn.model, cumulative);
        } else if (latest === cumulative && !turn) {
          warnings.add("A token event has no matching turn; model usage is unavailable.");
        }
        warnings.add("Cumulative token usage reset; pre-reset model attribution is unavailable.");
        warnings.add("Partial report: pre-reset epoch is not represented by latest total.");
      }
      previousCumulative = cumulative;
    } else if (latest !== null) {
      warnings.add("A token event has no cumulative identity; model usage is unavailable.");
    }
  }

  if (total !== null) {
    const attributed = [...models.values()].reduce((sum, tokens) => sum + tokens, 0);
    if (attributed < total) {
      models.set("unknown", (models.get("unknown") || 0) + total - attributed);
      warnings.add("Unmatched exact token remainder is attributed to unknown model.");
    } else if (attributed > total) {
      models.clear();
      models.set("unknown", total);
      warnings.add("Model token events exceed exact rollout total; model attribution is unavailable.");
    }
  }
  return { id, parentId: session.parent_thread_id || null, role: session.agent_role || "unknown", total, models, warnings };
}

function currentReport(event, state, deadline = Infinity) {
  const sessionsDir = process.env.DIRIGENT_STATS_CODEX_SESSIONS_DIR || path.join(process.env.HOME || "", ".codex", "sessions");
  const sessionId = event.session_id || event.thread_id;
  if (typeof sessionId !== "string" || !sessionId || Date.now() > deadline) return null;
  const files = jsonlFiles(sessionsDir, [], deadline);
  const transcript = state && state.transcriptPath !== null ? state.transcriptPath : resolveTranscript(event, files, deadline);
  const selected = transcript && parseRollout(transcript, deadline);
  if (!selected || selected.id !== sessionId || Date.now() > deadline) return null;
  const children = new Map();
  if (selected.parentId) children.set(selected.parentId, [selected]);
  for (let index = 0; index < files.length; index += 1) {
    if (index % 16 === 0 && Date.now() > deadline) return null;
    const file = files[index];
    if (file === transcript) continue;
    const rollout = parseRollout(file, deadline);
    if (!rollout) continue;
    if (!rollout.parentId) continue;
    const items = children.get(rollout.parentId) || [];
    items.push(rollout);
    children.set(rollout.parentId, items);
  }
  const rollouts = [selected];
  const seen = new Set([selected.id]);
  const pending = [selected.id];
  while (pending.length) {
    if (Date.now() > deadline) return null;
    for (const child of (children.get(pending.shift()) || []).sort((a, b) => a.id.localeCompare(b.id))) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      rollouts.push(child);
      pending.push(child.id);
    }
  }
  return { reportText: report(selected, rollouts), transcriptPath: path.resolve(transcript) };
}

function report(root, rollouts) {
  const agents = new Map();
  const models = new Map();
  const warnings = new Set();
  let total = 0;
  for (const rollout of rollouts) {
    for (const warning of rollout.warnings) warnings.add(warning);
    if (rollout.total === null) {
      warnings.add("Partial report: usage unavailable for one or more rollouts; excluded from totals.");
      continue;
    }
    total += rollout.total;
    const role = rollout.id === root.id ? "orchestrator" : rollout.role;
    const agent = agents.get(role) || { runs: 0, tokens: 0, models: new Set() };
    agent.runs += 1;
    agent.tokens += rollout.total;
    for (const [model, tokens] of rollout.models) {
      agent.models.add(model);
      const row = models.get(model) || { runs: new Set(), tokens: 0 };
      row.runs.add(rollout.id);
      row.tokens += tokens;
      models.set(model, row);
    }
    agents.set(role, agent);
  }
  const share = (tokens) => `${(total ? tokens * 100 / total : 0).toFixed(1)}%`;
  const agentRows = [...agents.entries()].sort(([a], [b]) => (a === "orchestrator" ? -1 : b === "orchestrator" ? 1 : agents.get(b).tokens - agents.get(a).tokens || a.localeCompare(b)));
  const modelRows = [...models.entries()].sort(([a], [b]) => models.get(b).tokens - models.get(a).tokens || a.localeCompare(b));
  if (total === 0) return noData();
  const lines = [
    REPORT_HEADING,
    "",
    AGENT_HEADER,
    AGENT_SEPARATOR,
    ...agentRows.map(([role, row]) => `| ${role} | ${[...row.models].sort().join(", ")} | ${row.runs} | ${row.tokens} | ${share(row.tokens)} |`),
    "",
    MODEL_HEADER,
    MODEL_SEPARATOR,
    ...modelRows.map(([model, row]) => `| ${model} | ${row.runs.size} | ${row.tokens} | ${share(row.tokens)} |`),
    "",
    `Exact known total: ${total} tokens.`,
  ];
  if (warnings.size) lines.push("Warnings:", ...[...warnings].sort().map((warning) => `- ${warning}`));
  return lines.join("\n");
}

async function main() {
  let event;
  try { event = JSON.parse(await stdin()); } catch { return; }
  const sessionId = event && (event.session_id || event.thread_id);
  const stop = event && (event.hook_event_name === "Stop" || event.hookEventName === "Stop"
    || (typeof event.turn_id === "string" && !(event.prompt || event.user_prompt || event.message)));
  if (stop) {
    if (typeof sessionId !== "string" || !sessionId) return;
    const state = sessionState(sessionId);
    const deadline = Date.now() + STOP_BUDGET_MS;
    const fallback = noData();
    // Invalidate prior totals before unstable transcript parsing. Timeout/error
    // then leaves a current deterministic snapshot for this completed turn.
    writeState(sessionId, state, fallback, event.turn_id);
    let result = null;
    try { result = currentReport(event, state, deadline); } catch { /* Keep current no-data cache. */ }
    if (result) writeState(sessionId, state, result.reportText, event.turn_id, result.transcriptPath);
    return;
  }
  const prompt = event && (event.prompt || event.user_prompt || event.message || "");
  if (typeof prompt !== "string" || !INVOCATION.test(prompt)) return;
  if (typeof sessionId !== "string" || !sessionId) return;
  const state = sessionState(sessionId);
  let reportText = cachedReport(state, sessionId);
  if (!reportText) {
    // Schema-1/corrupt caches recover once on demand; normal requests never parse.
    let result = null;
    try { result = currentReport(event, state, Date.now() + STOP_BUDGET_MS); } catch { /* Use deterministic no-data report. */ }
    reportText = result ? result.reportText : noData();
    writeState(sessionId, state, reportText, event.turn_id, result && result.transcriptPath);
  }
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: reportText } }));
}

main().catch(() => {});
