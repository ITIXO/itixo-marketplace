const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.join(__dirname, "..");
const plugins = ["itixo-claude", "itixo-codex"];
const NO_DATA = "No token usage available yet.";

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dirigent-stats-test-"));
}

function statePath(stateDir, sessionId) {
  const hash = crypto.createHash("sha256").update(sessionId).digest("hex");
  return path.join(stateDir, `${hash}.json`);
}

function script(plugin, name) {
  return path.join(root, "plugins", plugin, "scripts", name);
}

function run(file, event, env = {}, args = []) {
  return spawnSync(process.execPath, [file, ...args], {
    encoding: "utf8",
    input: JSON.stringify(event),
    env: { ...process.env, ...env },
  });
}

function runOk(file, event, env = {}, args = []) {
  const result = run(file, event, env, args);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return result;
}

function start(plugin, event, stateDir) {
  return runOk(script(plugin, "dirigent-stats-session-start.js"), event, {
    DIRIGENT_STATS_STATE_DIR: stateDir,
  });
}

function lifecycle(plugin, event, stateDir, child = false) {
  const args = plugin === "itixo-claude"
    ? [child ? "--subagent-stop" : "--session-end"]
    : [];
  const name = plugin === "itixo-codex"
    ? (child ? "SubagentStop" : "SessionEnd")
    : event.hook_event_name;
  return runOk(script(plugin, "dirigent-stats.js"), { ...event, hook_event_name: name }, {
    DIRIGENT_STATS_STATE_DIR: stateDir,
  }, args);
}

function report(plugin, sessionId, stateDir, extra = {}) {
  const result = runOk(script(plugin, "dirigent-stats.js"), {
    prompt: "$dirigent-stats --view both", session_id: sessionId,
  }, { DIRIGENT_STATS_STATE_DIR: stateDir, ...extra });
  return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
}

function writeJsonl(file, records, suffix = "\n") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${records.map(JSON.stringify).join("\n")}${suffix}`);
}

function claudeUsage(tokens, model, id = "message") {
  return {
    type: "assistant",
    message: {
      id,
      ...(model ? { model } : {}),
      usage: { input_tokens: tokens },
    },
  };
}

function codexUsage(tokens) {
  return { type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { total_tokens: tokens } } } };
}

function rootEvent(plugin, sessionId, transcript, model = "root-model") {
  return plugin === "itixo-claude"
    ? { session_id: sessionId, transcript_path: transcript }
    : { session_id: sessionId, transcript_path: transcript, model };
}

function childEvent(plugin, sessionId, agentId, transcript, role, model) {
  return plugin === "itixo-claude"
    ? { session_id: sessionId, agent_id: agentId, agent_transcript_path: transcript, agent_type: role }
    : { session_id: sessionId, agent_id: agentId, agent_transcript_path: transcript, agent_type: role, ...(model ? { model } : {}) };
}

for (const plugin of plugins) {
  test(`${plugin}: root latest cumulative snapshot replaces prior snapshot`, () => {
    const stateDir = temporaryDirectory();
    const sessionId = `${plugin}-root-cumulative`;
    const transcript = path.join(temporaryDirectory(), "root.jsonl");
    const usage = plugin === "itixo-claude" ? claudeUsage : codexUsage;
    writeJsonl(transcript, [usage(1000, "root-model"), usage(2500, "root-model")]);
    start(plugin, { source: "startup", session_id: sessionId, transcript_path: transcript, model: "root-model" }, stateDir);
    lifecycle(plugin, rootEvent(plugin, sessionId, transcript), stateDir);
    assert.match(report(plugin, sessionId, stateDir), /Exact known total: 2\.5 kToks\./);

    fs.appendFileSync(transcript, `${JSON.stringify(usage(4000, "root-model"))}\n`);
    lifecycle(plugin, rootEvent(plugin, sessionId, transcript), stateDir);
    const output = report(plugin, sessionId, stateDir);
    assert.match(output, /\| orchestrator \| (?:Claude |Codex )?root-model \| 1 \| 4 kToks \| 100\.0% \|/);
    assert.match(output, /Exact known total: 4 kToks\./);
  });

  test(`${plugin}: unique run IDs aggregate root and same-role children`, () => {
    const stateDir = temporaryDirectory();
    const sessionId = `${plugin}-run-aggregation`;
    const temp = temporaryDirectory();
    const rootTranscript = path.join(temp, "root.jsonl");
    const childOne = path.join(temp, "child-one.jsonl");
    const childTwo = path.join(temp, "child-two.jsonl");
    const usage = plugin === "itixo-claude" ? claudeUsage : codexUsage;
    writeJsonl(rootTranscript, [usage(1000, "root-model")]);
    writeJsonl(childOne, [usage(2000, "worker-model")]);
    writeJsonl(childTwo, [usage(3000, "worker-model")]);
    start(plugin, { source: "startup", session_id: sessionId, transcript_path: rootTranscript, model: "root-model" }, stateDir);
    lifecycle(plugin, rootEvent(plugin, sessionId, rootTranscript), stateDir);
    if (plugin === "itixo-codex") {
      lifecycle(plugin, { hook_event_name: "SubagentStart", session_id: sessionId, agent_id: "worker-a", agent_type: "builder", model: "worker-model" }, stateDir, true);
      lifecycle(plugin, { hook_event_name: "SubagentStart", session_id: sessionId, agent_id: "worker-b", agent_type: "builder", model: "worker-model" }, stateDir, true);
    }
    lifecycle(plugin, childEvent(plugin, sessionId, "worker-a", childOne, "builder", "worker-model"), stateDir, true);
    lifecycle(plugin, childEvent(plugin, sessionId, "worker-b", childTwo, "builder", "worker-model"), stateDir, true);
    const output = report(plugin, sessionId, stateDir);
    assert.match(output, /\| builder \| (?:Claude |Codex )?worker-model \| 2 \| 5 kToks \| 83\.3% \|/);
    assert.match(output, /\| (?:Claude |Codex )?worker-model \| 2 \| 5 kToks \| 83\.3% \|/);
    assert.match(output, /Exact known total: 6 kToks\./);
  });

  test(`${plugin}: same agent ID replaces its prior cumulative run`, () => {
    const stateDir = temporaryDirectory();
    const sessionId = `${plugin}-run-replacement`;
    const temp = temporaryDirectory();
    const child = path.join(temp, "child.jsonl");
    const usage = plugin === "itixo-claude" ? claudeUsage : codexUsage;
    writeJsonl(child, [usage(1000, "worker-model")]);
    start(plugin, { source: "startup", session_id: sessionId }, stateDir);
    if (plugin === "itixo-codex") lifecycle(plugin, { hook_event_name: "SubagentStart", session_id: sessionId, agent_id: "worker", agent_type: "builder", model: "worker-model" }, stateDir, true);
    lifecycle(plugin, childEvent(plugin, sessionId, "worker", child, "builder", "worker-model"), stateDir, true);
    fs.appendFileSync(child, `${JSON.stringify(usage(3000, "worker-model"))}\n`);
    lifecycle(plugin, childEvent(plugin, sessionId, "worker", child, "builder", "worker-model"), stateDir, true);
    const output = report(plugin, sessionId, stateDir);
    assert.match(output, /\| builder \| (?:Claude |Codex )?worker-model \| 1 \| 3 kToks \| 100\.0% \|/);
    assert.match(output, /Exact known total: 3 kToks\./);
  });

  test(`${plugin}: role/model fallback labels remain explicit`, () => {
    const stateDir = temporaryDirectory();
    const sessionId = `${plugin}-fallbacks`;
    const temp = temporaryDirectory();
    const known = path.join(temp, "known.jsonl");
    const unknown = path.join(temp, "unknown.jsonl");
    const usage = plugin === "itixo-claude" ? claudeUsage : codexUsage;
    writeJsonl(known, [usage(1000)]);
    writeJsonl(unknown, [usage(2000)]);
    start(plugin, { source: "startup", session_id: sessionId }, stateDir);
    if (plugin === "itixo-codex") {
      lifecycle(plugin, { hook_event_name: "SubagentStart", session_id: sessionId, agent_id: "known", agent_type: "builder" }, stateDir, true);
      lifecycle(plugin, { hook_event_name: "SubagentStart", session_id: sessionId, agent_id: "unknown" }, stateDir, true);
    }
    lifecycle(plugin, childEvent(plugin, sessionId, "known", known, "builder"), stateDir, true);
    lifecycle(plugin, childEvent(plugin, sessionId, "unknown", unknown), stateDir, true);
    const output = report(plugin, sessionId, stateDir);
    assert.match(output, /\| builder \| (?:Claude |Codex )?<assumed> \| 1 \| 1 kToks \| 33\.3% \|/);
    assert.match(output, /\| unknown \| (?:Claude |Codex )?unknown \| 1 \| 2 kToks \| 66\.7% \|/);
  });
}

for (const plugin of plugins) {
  test(`${plugin}: resume preserves valid schema-3 cache and run offset`, () => {
    const stateDir = temporaryDirectory();
    const sessionId = `${plugin}-resume`;
    const file = statePath(stateDir, sessionId);
    fs.mkdirSync(stateDir, { recursive: true });
    const run = plugin === "itixo-claude"
      ? { agentId: sessionId, role: "orchestrator", provider: "Claude", model: "model", byteOffset: 37, tokens: 1000 }
      : { role: "orchestrator", provider: "Codex", model: "model", offset: 37, tokens: 1000 };
    fs.writeFileSync(file, JSON.stringify({ schema: 3, rootSessionId: sessionId, ...(plugin === "itixo-claude" ? { rootTranscriptPath: null } : {}), runs: { [sessionId]: run } }));
    start(plugin, { source: "resume", session_id: sessionId }, stateDir);
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepEqual(saved.runs[sessionId], run);
  });

  test(`${plugin}: cache-only prompt fails closed without historical discovery`, () => {
    const stateDir = temporaryDirectory();
    const sessionId = `${plugin}-missing-cache`;
    const preload = path.join(temporaryDirectory(), "block-jsonl.cjs");
    fs.writeFileSync(preload, [
      "const fs = require('node:fs');",
      "const read = fs.readFileSync;",
      "fs.readFileSync = function (file, ...args) {",
      "  if (String(file).endsWith('.jsonl')) throw new Error('historical transcript discovery');",
      "  return read.call(this, file, ...args);",
      "};",
    ].join("\n"));
    const result = spawnSync(process.execPath, [`--require=${preload}`, script(plugin, "dirigent-stats.js")], {
      encoding: "utf8",
      input: JSON.stringify({ prompt: "$dirigent-stats", session_id: sessionId, transcript_path: path.join(temporaryDirectory(), "historical.jsonl") }),
      env: { ...process.env, DIRIGENT_STATS_STATE_DIR: stateDir },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, NO_DATA);
  });

  test(`${plugin}: missing, malformed, old, zero, and invalid-offset cache data return no-data`, () => {
    const stateDir = temporaryDirectory();
    const sessionId = `${plugin}-invalid-cache`;
    const file = statePath(stateDir, sessionId);
    const invalidStates = [
      undefined,
      "{",
      { schema: 2, rootSessionId: sessionId, runs: {} },
      { schema: 3, rootSessionId: sessionId, ...(plugin === "itixo-claude" ? { rootTranscriptPath: null } : {}), runs: {} },
      { schema: 3, rootSessionId: sessionId, ...(plugin === "itixo-claude" ? { rootTranscriptPath: null } : {}), runs: { broken: plugin === "itixo-claude"
        ? { agentId: "broken", role: "builder", provider: "Claude", model: "model", byteOffset: -1, tokens: 1 }
        : { role: "builder", provider: "Codex", model: "model", offset: -1, tokens: 1 } } },
    ];
    for (const state of invalidStates) {
      fs.mkdirSync(stateDir, { recursive: true });
      if (state === undefined) fs.rmSync(file, { force: true });
      else fs.writeFileSync(file, typeof state === "string" ? state : JSON.stringify(state));
      assert.equal(report(plugin, sessionId, stateDir), NO_DATA);
    }
  });

  test(`${plugin}: absent or malformed token records and truncated offsets are unavailable`, () => {
    const stateDir = temporaryDirectory();
    const sessionId = `${plugin}-bad-token-data`;
    const transcript = path.join(temporaryDirectory(), "root.jsonl");
    fs.writeFileSync(transcript, "{not-json}\n");
    start(plugin, { source: "startup", session_id: sessionId, transcript_path: transcript, model: "model" }, stateDir);
    lifecycle(plugin, rootEvent(plugin, sessionId, transcript, "model"), stateDir);
    assert.equal(report(plugin, sessionId, stateDir), NO_DATA);

    const file = statePath(stateDir, sessionId);
    const run = plugin === "itixo-claude"
      ? { agentId: sessionId, role: "orchestrator", provider: "Claude", model: "model", byteOffset: 999, tokens: 1000 }
      : { role: "orchestrator", provider: "Codex", model: "model", offset: 999, tokens: 1000 };
    fs.writeFileSync(file, JSON.stringify({ schema: 3, rootSessionId: sessionId, ...(plugin === "itixo-claude" ? { rootTranscriptPath: transcript } : {}), runs: { [sessionId]: run } }));
    lifecycle(plugin, rootEvent(plugin, sessionId, transcript, "model"), stateDir);
    assert.equal(report(plugin, sessionId, stateDir), NO_DATA);
  });

  test(`${plugin}: expired lock is reclaimed and lifecycle update completes`, () => {
    const stateDir = temporaryDirectory();
    const sessionId = `${plugin}-stale-lock`;
    const transcript = path.join(temporaryDirectory(), "root.jsonl");
    const usage = plugin === "itixo-claude" ? claudeUsage : codexUsage;
    writeJsonl(transcript, [usage(1000, "model")]);
    start(plugin, { source: "startup", session_id: sessionId, transcript_path: transcript, model: "model" }, stateDir);
    const lock = `${statePath(stateDir, sessionId)}.lock`;
    fs.writeFileSync(lock, plugin === "itixo-claude" ? JSON.stringify({ owner: "orphan" }) : "{}");
    const stale = new Date(Date.now() - 60_000);
    fs.utimesSync(lock, stale, stale);

    const started = Date.now();
    lifecycle(plugin, rootEvent(plugin, sessionId, transcript, "model"), stateDir);
    assert.ok(Date.now() - started < 1_200, "stale lock delayed lifecycle update");
    assert.match(report(plugin, sessionId, stateDir), /Exact known total: 1 kToks\./);
    assert.equal(fs.existsSync(lock), false);
  });

  test(`${plugin}: root update consumes only data after cached offset`, () => {
    const stateDir = temporaryDirectory();
    const sessionId = `${plugin}-root-tail`;
    const transcript = path.join(temporaryDirectory(), "root.jsonl");
    const prefix = "x".repeat(300 * 1024);
    fs.writeFileSync(transcript, prefix);
    const run = plugin === "itixo-claude"
      ? { agentId: sessionId, role: "orchestrator", provider: "Claude", model: "model", byteOffset: Buffer.byteLength(prefix), tokens: 1000 }
      : { role: "orchestrator", provider: "Codex", model: "model", offset: Buffer.byteLength(prefix), tokens: 1000 };
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(statePath(stateDir, sessionId), JSON.stringify({
      schema: 3,
      rootSessionId: sessionId,
      ...(plugin === "itixo-claude" ? { rootTranscriptPath: transcript } : {}),
      runs: { [sessionId]: run },
    }));
    const usage = plugin === "itixo-claude" ? claudeUsage : codexUsage;
    fs.appendFileSync(transcript, `\n${JSON.stringify(usage(2000, "model"))}\n`);
    lifecycle(plugin, rootEvent(plugin, sessionId, transcript, "model"), stateDir);
    assert.match(report(plugin, sessionId, stateDir), /Exact known total: 2 kToks\./);
  });
}
