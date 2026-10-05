"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const PROVIDERS = ["claude", "codex", "copilot"];

function sandbox(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "itixo-dirigent-test-"));
  const env = {
    ...process.env,
    HOME: root,
    CLAUDE_CONFIG_DIR: path.join(root, "claude-config"),
    CODEX_HOME: path.join(root, "codex-config"),
    COPILOT_HOME: path.join(root, "copilot-config"),
    CLAUDE_PLUGIN_DATA: path.join(root, "plugin-data"),
    PLUGIN_DATA: path.join(root, "plugin-data"),
    COPILOT_PLUGIN_DATA: path.join(root, "plugin-data"),
    TMPDIR: root,
  };
  try {
    return callback({ root, env });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function script(provider) {
  return path.join(ROOT, "plugins", provider, "itixo", "scripts", "dirigent-runtime.js");
}

function run(provider, action, env, input = {}, extra = []) {
  return spawnSync(process.execPath, [script(provider), provider, action, ...extra], {
    encoding: "utf8",
    env,
    input: JSON.stringify(input),
  });
}

function hook(provider, action, env, input) {
  const result = run(provider, action, env, input);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return result.stdout ? JSON.parse(result.stdout) : null;
}

function set(provider, state, sessionId, env, extra = []) {
  const result = run(provider, "set", env, {}, [state, "--session", sessionId, ...extra]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

function enabled(provider, sessionId, env) {
  const result = spawnSync(
    process.execPath,
    ["-e", "process.stdout.write(String(require(process.argv[1]).isEnabled(process.argv[2], process.argv[3])))", script(provider), provider, sessionId],
    { encoding: "utf8", env }
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout === "true";
}

function context(output) {
  return output?.hookSpecificOutput?.additionalContext ?? output?.additionalContext ?? "";
}

for (const provider of PROVIDERS) {
  test(`${provider}: explicit prompt toggle stays in its session`, () => sandbox(({ env }) => {
    assert.equal(enabled(provider, "chat-a", env), false);
    const initial = hook(provider, "session-start", env, { session_id: "chat-a", sessionId: "chat-a" });
    assert.match(context(initial), /Dirigent OFF/);
    assert.doesNotMatch(context(initial), /Apply these Dirigent instructions/);
    const toggled = hook(provider, "user-prompt-submit", env, { session_id: "chat-a", sessionId: "chat-a", prompt: "/dirigent on" });
    if (provider === "copilot") assert.equal(toggled, null);
    else assert.match(context(toggled), /Dirigent ON/);
    assert.equal(enabled(provider, "chat-a", env), true);
    assert.equal(enabled(provider, "chat-b", env), false);
    const resumed = hook(provider, "session-start", env, { session_id: "chat-a", sessionId: "chat-a" });
    assert.match(context(resumed), /Apply these Dirigent instructions/);
    assert.equal(enabled(provider, "chat-a", env), true);
    hook(provider, "user-prompt-submit", env, { session_id: "chat-a", sessionId: "chat-a", prompt: "turn off dirigent" });
    assert.equal(enabled(provider, "chat-a", env), false);
  }));

  test(`${provider}: natural toggles are exact requests, not discussion`, () => sandbox(({ env }) => {
    hook(provider, "session-start", env, { session_id: "chat" });
    for (const prompt of [
      "Review triggers for dirigent skill.",
      "Quote: turn on dirigent",
      "`/dirigent on`",
      "Please explain how to turn on dirigent",
    ]) {
      hook(provider, "user-prompt-submit", env, { session_id: "chat", prompt });
      assert.equal(enabled(provider, "chat", env), false, prompt);
    }
    hook(provider, "user-prompt-submit", env, { session_id: "chat", prompt: "turn on dirigent for futur use" });
    assert.equal(enabled(provider, "chat", env), true);
    hook(provider, "session-start", env, { session_id: "next" });
    assert.equal(enabled(provider, "next", env), true);
    hook(provider, "user-prompt-submit", env, { session_id: "chat", prompt: "stop dirigent globally" });
    assert.equal(enabled(provider, "chat", env), false);
    assert.equal(enabled(provider, "next", env), true);
    hook(provider, "session-start", env, { session_id: "later" });
    assert.equal(enabled(provider, "later", env), false);
  }));

  test(`${provider}: global preference seeds new chats, while plain off is local`, () => sandbox(({ env }) => {
    const saved = set(provider, "on", "chat-a", env, ["--global"]);
    assert.equal(saved.enabled, true);
    assert.equal(saved.global, true);
    assert.equal(enabled(provider, "chat-a", env), true);
    hook(provider, "session-start", env, { session_id: "chat-b", sessionId: "chat-b" });
    assert.equal(enabled(provider, "chat-b", env), true);
    set(provider, "off", "chat-b", env);
    assert.equal(enabled(provider, "chat-b", env), false);
    hook(provider, "session-start", env, { session_id: "chat-b", sessionId: "chat-b" });
    assert.equal(enabled(provider, "chat-b", env), false);
    hook(provider, "session-start", env, { session_id: "chat-c", sessionId: "chat-c" });
    assert.equal(enabled(provider, "chat-c", env), true);
    set(provider, "off", "chat-c", env, ["--global"]);
    assert.equal(enabled(provider, "chat-c", env), false);
    hook(provider, "session-start", env, { session_id: "chat-d", sessionId: "chat-d" });
    assert.equal(enabled(provider, "chat-d", env), false);
  }));
}

test("provider flags remain isolated in a shared plugin-data directory", () => sandbox(({ env }) => {
  set("claude", "on", "same-chat", env, ["--global"]);
  assert.equal(enabled("claude", "same-chat", env), true);
  assert.equal(enabled("codex", "same-chat", env), false);
  assert.equal(enabled("copilot", "same-chat", env), false);
  hook("codex", "session-start", env, { session_id: "new-chat" });
  assert.equal(enabled("codex", "new-chat", env), false);
}));

test("subagents inherit enabled state without root instructions", () => sandbox(({ env }) => {
  for (const provider of PROVIDERS) {
    assert.equal(hook(provider, "subagent-start", env, { session_id: "chat" }), null);
    set(provider, "on", "chat", env);
    const child = hook(provider, "subagent-start", env, { session_id: "chat" });
    assert.match(context(child), /enabled in the parent chat/);
    assert.doesNotMatch(context(child), /Apply these Dirigent instructions/);
    assert.equal(hook(provider, "subagent-start", env, { session_id: "other-chat" }), null);
  }
}));

test("missing session ID cannot create shared state", () => sandbox(({ env }) => {
  for (const provider of PROVIDERS) {
    hook(provider, "session-start", env, {});
    hook(provider, "user-prompt-submit", env, { prompt: "/dirigent on" });
    assert.equal(enabled(provider, "unknown", env), false);
    assert.equal(fs.existsSync(path.join(env.PLUGIN_DATA, "dirigent", provider)), false);
  }
}));

test("failed manual writes do not report a saved preference", () => sandbox(({ root, env }) => {
  const blocked = path.join(root, "file-instead-of-directory");
  fs.writeFileSync(blocked, "keep");
  for (const provider of PROVIDERS) {
    const result = run(provider, "set", env, {}, ["on", "--session", "chat", "--global", "--state-dir", blocked]);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Dirigent:/);
  }
  assert.equal(fs.readFileSync(blocked, "utf8"), "keep");
}));

test("manual control accepts an isolated state directory and malformed defaults fail closed", () => sandbox(({ root, env }) => {
  const directory = path.join(root, "manual-state");
  const saved = set("codex", "on", "manual-chat", env, ["--state-dir", directory]);
  assert.equal(saved.stateDir, directory);
  assert.equal(fs.readdirSync(directory).length, 1);
  const off = set("codex", "off", "manual-chat", env, ["--state-dir", directory]);
  assert.equal(off.enabled, false);
  const defaultDir = path.join(env.PLUGIN_DATA, "dirigent", "codex");
  fs.mkdirSync(defaultDir, { recursive: true });
  fs.writeFileSync(path.join(defaultDir, "default.json"), "{broken");
  const result = hook("codex", "session-start", env, { session_id: "new-chat" });
  assert.match(context(result), /Dirigent OFF/);
  assert.equal(enabled("codex", "new-chat", env), false);
}));

test("Claude delegation hooks are silent while off and active while on", () => sandbox(({ root, env }) => {
  const sessionId = `test-${path.basename(root)}`;
  const input = { session_id: sessionId, tool_name: "Grep", tool_input: { pattern: "thing" } };
  const claudeScript = (name) => path.join(ROOT, "plugins", "claude", "itixo", "scripts", name);
  const call = (name, data) => spawnSync(process.execPath, [claudeScript(name)], {
    encoding: "utf8", env, input: JSON.stringify(data),
  });
  assert.equal(call("investigation-nudge.js", input).stdout, "");
  assert.equal(call("log-tool.js", input).stdout, "");
  assert.equal(call("delegation-summary.js", { session_id: sessionId }).stderr, "");
  assert.equal(fs.existsSync(path.join(root, `itixo-delegation-${sessionId}.jsonl`)), false);
  set("claude", "on", sessionId, env);
  assert.match(call("investigation-nudge.js", input).stdout, /itixo/);
  call("log-tool.js", { session_id: sessionId, tool_name: "Edit", tool_input: { file_path: "x" } });
  assert.match(call("delegation-summary.js", { session_id: sessionId }).stderr, /Delegation stats/);
}));
