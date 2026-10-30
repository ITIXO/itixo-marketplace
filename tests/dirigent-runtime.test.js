"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
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

function mode(provider, sessionId, env) {
  const result = spawnSync(
    process.execPath,
    ["-e", "process.stdout.write(require(process.argv[1]).effectiveMode(process.argv[2], process.argv[3]))", script(provider), provider, sessionId],
    { encoding: "utf8", env }
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

const { parseToggle } = require(script("claude"));

function stateFile(env, provider, feature, sessionId) {
  const name = sessionId === "default" ? "default.json"
    : `session-${crypto.createHash("sha256").update(sessionId).digest("hex")}.json`;
  return path.join(env.PLUGIN_DATA, feature, provider, name);
}

function put(env, provider, feature, sessionId, data) {
  const file = stateFile(env, provider, feature, sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data) + "\n");
}

const rules = (provider, name) => fs.readFileSync(path.join(ROOT, "plugins", provider, "itixo", "rules", name), "utf8");

function context(output) {
  return output?.hookSpecificOutput?.additionalContext ?? output?.additionalContext ?? "";
}

for (const provider of PROVIDERS) {
  test(`${provider}: explicit prompt toggle stays in its session`, () => sandbox(({ env }) => {
    assert.equal(enabled(provider, "chat-a", env), false);
    const initial = hook(provider, "session-start", env, { session_id: "chat-a", sessionId: "chat-a" });
    assert.match(context(initial), /Dirigent OFF/);
    assert.doesNotMatch(context(initial), /Dirigent is enabled\. Apply these rules/);
    const toggled = hook(provider, "user-prompt-submit", env, { session_id: "chat-a", sessionId: "chat-a", prompt: "/dirigent on" });
    if (provider === "copilot") assert.equal(toggled, null);
    else assert.match(context(toggled), /Dirigent ON/);
    assert.equal(enabled(provider, "chat-a", env), true);
    assert.equal(enabled(provider, "chat-b", env), false);
    const resumed = hook(provider, "session-start", env, { session_id: "chat-a", sessionId: "chat-a" });
    assert.match(context(resumed), /Dirigent is enabled\. Apply these rules/);
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
      "Is dirigent on?",
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
    hook(provider, "user-prompt-submit", env, { session_id: "later", prompt: "dirigent on" });
    assert.equal(enabled(provider, "later", env), true);
    hook(provider, "user-prompt-submit", env, { session_id: "later", prompt: "Dirigent off" });
    assert.equal(enabled(provider, "later", env), false);
    hook(provider, "user-prompt-submit", env, { session_id: "later", prompt: "dirigent on globally" });
    assert.equal(enabled(provider, "later", env), true);
    hook(provider, "session-start", env, { session_id: "last" });
    assert.equal(enabled(provider, "last", env), true);
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
    assert.doesNotMatch(context(child), /Dirigent is enabled\. Apply these rules/);
    assert.equal(hook(provider, "subagent-start", env, { session_id: "other-chat" }), null);
  }
}));

test("missing session ID cannot create shared state", () => sandbox(({ env }) => {
  for (const provider of PROVIDERS) {
    hook(provider, "session-start", env, {});
    hook(provider, "user-prompt-submit", env, { prompt: "/dirigent on" });
    assert.equal(enabled(provider, "unknown", env), false);
    assert.equal(fs.existsSync(path.join(env.PLUGIN_DATA, "dirigent", provider)), false);
    assert.equal(fs.existsSync(path.join(env.PLUGIN_DATA, "teamlead", provider)), false);
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

test("enabled context stays under Claude's hook limit and inlines rules", () => sandbox(({ env }) => {
  for (const provider of PROVIDERS) {
    set(provider, "on", "chat", env);
    const text = context(hook(provider, "session-start", env, { session_id: "chat" }));
    assert.ok(text.length < 10000, `${provider}: ${text.length} chars`);
    assert.ok(!text.includes("SKILL.md"));
    assert.ok(text.includes(fs.readFileSync(path.join(ROOT, "plugins", provider, "itixo", "rules", "agents.md"), "utf8")));
    set(provider, "on", "tl", env, ["--feature", "teamlead"]);
    const tl = context(hook(provider, "session-start", env, { session_id: "tl" }));
    assert.ok(tl.length < 10000, `${provider} teamlead: ${tl.length} chars`);
  }
}));

test("Claude session start also covers forked sessions", () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, "plugins", "claude", "itixo", "hooks", "hooks.json"), "utf8"));
  assert.ok(hooks.hooks.SessionStart.some((entry) => entry.matcher.split("|").includes("fork")));
});

test("Windows manual control matches each provider's shell", () => sandbox(({ env }) => {
  for (const [provider, powerShell] of [["claude", false], ["codex", true], ["copilot", true]]) {
    const result = spawnSync(process.execPath, ["-e",
      "Object.defineProperty(process, 'platform', { value: 'win32' }); require(process.argv[1]).invoke([process.argv[2], 'session-start'])",
      script(provider), provider], { encoding: "utf8", env, input: JSON.stringify({ session_id: "chat" }) });
    assert.equal(result.status, 0, result.stderr);
    const control = context(JSON.parse(result.stdout)).match(/Manual control: (.+?) \(replace/)[1];
    assert.equal(control.startsWith("& "), powerShell, `${provider}: ${control}`);
  }
}));


const TL = ["--feature", "teamlead"];

for (const provider of PROVIDERS) {
  test(`${provider}: teamlead session toggle`, () => sandbox(({ env }) => {
    const saved = set(provider, "on", "c", env, TL);
    assert.equal(saved.feature, "teamlead");
    assert.ok(fs.existsSync(path.join(env.PLUGIN_DATA, "teamlead", provider)));
    assert.equal(mode(provider, "c", env), "teamlead");
    assert.equal(enabled(provider, "c", env), false);
    const text = context(hook(provider, "session-start", env, { session_id: "c" }));
    assert.match(text, /Teamlead is enabled\. Apply these rules/);
    assert.ok(text.includes(rules(provider, "teamlead.md")));
    assert.ok(!text.includes(rules(provider, "agents.md")));
    set(provider, "off", "c", env, TL);
    assert.equal(mode(provider, "c", env), "none");
  }));

  test(`${provider}: latest toggle wins without fallback`, () => sandbox(({ env }) => {
    put(env, provider, "dirigent", "c", { enabled: true, at: 1 });
    put(env, provider, "teamlead", "c", { enabled: true, at: 2 });
    assert.equal(mode(provider, "c", env), "teamlead");
    set(provider, "on", "c", env);
    assert.equal(mode(provider, "c", env), "dirigent");
    set(provider, "off", "c", env);
    assert.equal(mode(provider, "c", env), "none");
    put(env, provider, "dirigent", "d", { enabled: true, at: 1 });
    put(env, provider, "teamlead", "d", { enabled: true, at: 2 });
    set(provider, "off", "d", env);
    assert.equal(mode(provider, "d", env), "teamlead");
  }));

  test(`${provider}: tie asks, then off keeps the other mode`, () => sandbox(({ env }) => {
    put(env, provider, "dirigent", "c", { enabled: true, at: 5 });
    put(env, provider, "teamlead", "c", { enabled: true, at: 5 });
    assert.equal(mode(provider, "c", env), "ask");
    const text = context(hook(provider, "session-start", env, { session_id: "c" }));
    assert.match(text, /ask the user which mode to use/);
    assert.ok(!text.includes(rules(provider, "agents.md")));
    assert.ok(!text.includes(rules(provider, "teamlead.md")));
    assert.equal(hook(provider, "subagent-start", env, { session_id: "c" }), null);
    set(provider, "off", "c", env, TL);
    assert.equal(mode(provider, "c", env), "dirigent");
  }));

  test(`${provider}: new session seeds from globals`, () => sandbox(({ env }) => {
    const cases = [
      [{ enabled: true, at: 100 }, { enabled: true, at: 200 }, "teamlead"],
      [{ enabled: true, at: 200 }, { enabled: true, at: 100 }, "dirigent"],
      [{ enabled: true }, { enabled: true, at: 200 }, "teamlead"],
      [{ enabled: true, at: 7 }, { enabled: true, at: 7 }, "ask"],
    ];
    cases.forEach(([d, t, expected], i) => {
      put(env, provider, "dirigent", "default", d);
      put(env, provider, "teamlead", "default", t);
      hook(provider, "session-start", env, { session_id: `s${i}` });
      assert.equal(mode(provider, `s${i}`, env), expected, `case ${i}`);
    });
  }));

  test(`${provider}: legacy session file still enables Dirigent`, () => sandbox(({ env }) => {
    put(env, provider, "dirigent", "c", { enabled: true });
    const file = stateFile(env, provider, "dirigent", "c");
    const before = fs.readFileSync(file, "utf8");
    assert.equal(enabled(provider, "c", env), true);
    assert.equal(mode(provider, "c", env), "dirigent");
    hook(provider, "session-start", env, { session_id: "c" });
    assert.equal(fs.readFileSync(file, "utf8"), before);
  }));

  test(`${provider}: subagents under teamlead get teamlead text only`, () => sandbox(({ env }) => {
    set(provider, "on", "c", env, TL);
    const text = context(hook(provider, "subagent-start", env, { session_id: "c" }));
    assert.match(text, /Teamlead is enabled in the parent chat/);
    assert.doesNotMatch(text, /Dirigent/);
  }));
}

test("teamlead global stays in its provider", () => sandbox(({ env }) => {
  set("claude", "on", "x", env, [...TL, "--global"]);
  for (const provider of ["codex", "copilot"]) {
    hook(provider, "session-start", env, { session_id: "new" });
    assert.equal(mode(provider, "new", env), "none");
  }
  hook("claude", "session-start", env, { session_id: "new" });
  assert.equal(mode("claude", "new", env), "teamlead");
}));

test("toggle parser", () => {
  const on = (feature, global = false) => ({ feature, enabled: true, global });
  const off = (feature, global = false) => ({ feature, enabled: false, global });
  const table = [
    ["/teamlead", on("teamlead")],
    ["/teamlead on --global", on("teamlead", true)],
    ["$itixo:teamlead off", off("teamlead")],
    ["/teamlead OFF", off("teamlead")],
    ["/dirigent OFF", off("dirigent")],
    ["use teamlead", on("teamlead")],
    ["turn on teamlead", on("teamlead")],
    ["Teamlead on", on("teamlead")],
    ["teamlead off", off("teamlead")],
    ["stop teamlead", off("teamlead")],
    ["use teamlead globally", on("teamlead", true)],
    ["turn on teamlead for future sessions", on("teamlead", true)],
    ["Review triggers for teamlead skill.", null],
    ["`/teamlead on`", null],
    ["Is teamlead on?", null],
    ["/teamleader on", null],
    ["team lead on", null],
    ["Please explain how to turn on teamlead", null],
  ];
  for (const [prompt, expected] of table) assert.deepEqual(parseToggle(prompt), expected, prompt);
});

test("Claude delegation hooks are silent under teamlead", () => sandbox(({ root, env }) => {
  const sessionId = `test-${path.basename(root)}`;
  const call = (name, data) => spawnSync(process.execPath, [path.join(ROOT, "plugins", "claude", "itixo", "scripts", name)], {
    encoding: "utf8", env, input: JSON.stringify(data),
  });
  put(env, "claude", "dirigent", sessionId, { enabled: true, at: 1 });
  put(env, "claude", "teamlead", sessionId, { enabled: true, at: 2 });
  assert.equal(mode("claude", sessionId, env), "teamlead");
  const input = { session_id: sessionId, tool_name: "Grep", tool_input: { pattern: "thing" } };
  assert.equal(call("investigation-nudge.js", input).stdout, "");
  call("log-tool.js", { session_id: sessionId, tool_name: "Edit", tool_input: { file_path: "x" } });
  assert.equal(call("delegation-summary.js", { session_id: sessionId }).stdout, "");
}));

test("runtime copies are byte-identical", () => {
  const [a, ...rest] = PROVIDERS.map((p) => fs.readFileSync(script(p)));
  for (const b of rest) assert.ok(a.equals(b));
});
