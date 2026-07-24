const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const os = require("node:os");

const root = path.join(__dirname, "..");
const plugins = ["itixo-claude", "itixo-codex"];
const skillRel = "skills/dirigent-stats/SKILL.md";
const metadataRel = "skills/dirigent-stats/agents/openai.yaml";

function read(plugin, rel) {
  return fs.readFileSync(path.join(root, "plugins", plugin, rel), "utf8");
}

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dirigent-stats-test-"));
}

function run(script, input, env = {}) {
  return spawnSync(process.execPath, [script], {
    encoding: "utf8",
    input: JSON.stringify(input),
    env: { ...process.env, ...env },
  });
}

function context(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
}

function startSession(plugin, event, stateDir) {
  return run(path.join(root, "plugins", plugin, "scripts", "dirigent-stats-session-start.js"), event, {
    DIRIGENT_STATS_STATE_DIR: stateDir,
  });
}

function statsStopCommand(plugin) {
  const hooks = JSON.parse(read(plugin, "hooks/hooks.json")).hooks;
  const commands = (hooks.Stop || []).flatMap((entry) => entry.hooks || [])
    .map((hook) => hook.command)
    .filter((command) => typeof command === "string" && /dirigent-stats/i.test(command));
  assert.ok(commands.length > 0, `${plugin} must register a stats update on Stop`);
  return commands[0].replace(/\$\{(?:CLAUDE_)?PLUGIN_ROOT\}/g, path.join(root, "plugins", plugin));
}

function stopSession(plugin, event, stateDir, env = {}) {
  return spawnSync(statsStopCommand(plugin), {
    shell: true,
    encoding: "utf8",
    input: JSON.stringify(event),
    env: { ...process.env, ...env, DIRIGENT_STATS_STATE_DIR: stateDir },
  });
}

function statePath(stateDir, sessionId) {
  return path.join(stateDir, `${crypto.createHash("sha256").update(sessionId).digest("hex")}.json`);
}

function startSessionConcurrently(plugin, event, stateDir) {
  const child = spawn(process.execPath, [path.join(root, "plugins", plugin, "scripts", "dirigent-stats-session-start.js")], {
    env: { ...process.env, DIRIGENT_STATS_STATE_DIR: stateDir },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end(JSON.stringify(event));
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => {
      if (status === 0 && !stderr) resolve();
      else reject(new Error(`SessionStart exited ${status}: ${stderr}`));
    });
  });
}

function assertCompleteMarker(file, sessionId) {
  const marker = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.ok(Number.isInteger(marker.schema) && marker.schema >= 1);
  assert.equal(marker.sessionId, sessionId);
}

function preload(source) {
  const directory = temporaryDirectory();
  const file = path.join(directory, "preload.cjs");
  fs.writeFileSync(file, source);
  return { directory, option: `--require=${file}` };
}

test("SessionStart persists isolated, atomically refreshed provider session markers", () => {
  for (const plugin of plugins) {
    const stateDir = temporaryDirectory();
    const script = path.join(root, "plugins", plugin, "scripts", "dirigent-stats-session-start.js");
    for (const source of ["startup", "resume", "clear", "compact"]) {
      const sessionId = `${plugin}-${source}-real-session-id`;
      const result = run(script, { source, session_id: sessionId, transcript_path: `/tmp/${source}.jsonl`, cwd: "/tmp" }, {
        DIRIGENT_STATS_STATE_DIR: stateDir,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, "");
      const file = statePath(stateDir, sessionId);
      assert.ok(fs.existsSync(file));
      assert.doesNotMatch(path.basename(file), new RegExp(sessionId));
      const marker = JSON.parse(fs.readFileSync(file, "utf8"));
      assert.ok(Number.isInteger(marker.schema) && marker.schema >= 1);
      assert.deepEqual(
        { sessionId: marker.sessionId, transcriptPath: marker.transcriptPath, cwd: marker.cwd, source: marker.source },
        { sessionId, transcriptPath: path.resolve(`/tmp/${source}.jsonl`), cwd: "/tmp", source },
      );
    }

    const sameId = `${plugin}-refresh`;
    startSession(plugin, { source: "startup", session_id: sameId, transcript_path: "/tmp/old.jsonl" }, stateDir);
    startSession(plugin, { source: "compact", session_id: sameId, transcript_path: "/tmp/new.jsonl" }, stateDir);
    assert.equal(JSON.parse(fs.readFileSync(statePath(stateDir, sameId), "utf8")).transcriptPath, path.resolve("/tmp/new.jsonl"));
    assert.equal(fs.readdirSync(stateDir).filter((name) => name.endsWith(".tmp")).length, 0);

    const before = fs.readdirSync(stateDir).sort();
    for (const event of [
      { source: "startup" },
      { source: "startup", session_id: "" },
      { source: "startup", session_id: "bad\0id" },
      { source: "other", session_id: `${plugin}-ignored` },
      "not-json",
    ]) {
      const result = spawnSync(process.execPath, [script], {
        encoding: "utf8", input: typeof event === "string" ? event : JSON.stringify(event),
        env: { ...process.env, DIRIGENT_STATS_STATE_DIR: stateDir },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, "");
    }
    assert.deepEqual(fs.readdirSync(stateDir).sort(), before);
  }
});

test("concurrent SessionStart writes keep every marker complete and isolated", async () => {
  for (const plugin of plugins) {
    const stateDir = temporaryDirectory();
    const sameId = `${plugin}-concurrent-same`;
    const distinctIds = Array.from({ length: 6 }, (_, index) => `${plugin}-concurrent-${index}`);
    const sessionIds = [sameId, ...distinctIds];
    for (const sessionId of sessionIds) {
      startSession(plugin, { source: "startup", session_id: sessionId, transcript_path: "/tmp/seed.jsonl" }, stateDir);
    }
    const writes = [
      ...Array.from({ length: 12 }, (_, index) => startSessionConcurrently(plugin, {
        source: index % 2 ? "compact" : "resume", session_id: sameId, transcript_path: `/tmp/same-${index}.jsonl`,
      }, stateDir)),
      ...distinctIds.map((sessionId, index) => startSessionConcurrently(plugin, {
        source: "clear", session_id: sessionId, transcript_path: `/tmp/distinct-${index}.jsonl`,
      }, stateDir)),
    ];
    let settled = false;
    const completion = Promise.all(writes).then(() => { settled = true; });
    for (let poll = 0; !settled && poll < 500; poll++) {
      for (const sessionId of sessionIds) assertCompleteMarker(statePath(stateDir, sessionId), sessionId);
      await new Promise((resolve) => setImmediate(resolve));
    }
    await completion;
    for (const sessionId of sessionIds) assertCompleteMarker(statePath(stateDir, sessionId), sessionId);
    assert.equal(fs.readdirSync(stateDir).filter((name) => name.endsWith(".json")).length, sessionIds.length);
  }
});

test("hashed marker paths contain traversal IDs", () => {
  const claudeFixture = path.join(root, "tests", "fixtures", "dirigent-stats", "claude");
  const claudeProjects = path.join(claudeFixture, "projects");
  const codexSessions = path.join(root, "tests", "fixtures", "dirigent-stats", "codex", "sessions");
  const cases = [
    {
      plugin: "itixo-claude", sessionId: "root-run", root: path.join(claudeProjects, "synthetic-project", "root-run.jsonl"),
      script: path.join(root, "plugins", "itixo-claude", "scripts", "dirigent-stats.js"),
      env: { DIRIGENT_STATS_CLAUDE_PROJECTS_DIR: claudeProjects, DIRIGENT_STATS_CLAUDE_LEDGER_DIR: path.join(claudeFixture, "ledger") },
    },
    {
      plugin: "itixo-codex", sessionId: "root-rollout", root: path.join(codexSessions, "root.jsonl"),
      script: path.join(root, "plugins", "itixo-codex", "scripts", "dirigent-stats.js"),
      env: { DIRIGENT_STATS_CODEX_SESSIONS_DIR: codexSessions },
    },
  ];
  for (const current of cases) {
    const stateDir = temporaryDirectory();
    const traversalId = "../other/..\\session-id";
    startSession(current.plugin, { source: "startup", session_id: traversalId }, stateDir);
    const traversalMarker = statePath(stateDir, traversalId);
    assert.equal(path.dirname(traversalMarker), stateDir);
    assertCompleteMarker(traversalMarker, traversalId);

  }
});

test("dirigent-stats skill is byte-identical across providers", () => {
  assert.equal(read(plugins[0], skillRel), read(plugins[1], skillRel));
  assert.equal(read(plugins[0], metadataRel), read(plugins[1], metadataRel));
});

test("dirigent-stats exposes explicit and implicit invocation metadata", () => {
  const skill = read("itixo-codex", skillRel);
  const metadata = read("itixo-codex", metadataRel);

  assert.match(skill, /^name: dirigent-stats$/m);
  assert.match(skill, /`\/dirigent-stats`/);
  assert.match(skill, /`\$dirigent-stats`/);
  assert.match(metadata, /display_name: "Dirigent Stats"/);
  assert.match(metadata, /short_description: "[^"\n]+"/);
  assert.match(metadata, /default_prompt: "Use \$dirigent-stats[^"\n]*"/);
  assert.doesNotMatch(metadata, /implicit_invocation:\s*true/);
});

test("dirigent-stats only returns hook-generated exact report", () => {
  const skill = read("itixo-codex", skillRel);
  for (const pattern of [
    /hook-provided report/i,
    /verbatim/i,
    /never estimate/i,
    /unknown values and warnings/i,
    /unavailable rather than estimating/i,
  ]) {
    assert.match(skill, pattern);
  }
  assert.match(skill, /current session/i);
  assert.match(skill, /root orchestrator and recursive subagents/i);
});

test("Claude report aggregates recursive descendants without leaking unrelated data", () => {
  const fixture = path.join(root, "tests", "fixtures", "dirigent-stats", "claude");
  const projects = path.join(fixture, "projects");
  const ledger = path.join(fixture, "ledger");
  const transcript = path.join(projects, "synthetic-project", "root-run.jsonl");
  const script = path.join(root, "plugins", "itixo-claude", "scripts", "dirigent-stats.js");
  const stateDir = temporaryDirectory();
  startSession("itixo-claude", { source: "startup", session_id: "root-run", transcript_path: transcript }, stateDir);
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    input: JSON.stringify({ prompt: "$dirigent-stats", session_id: "root-run", transcript_path: path.join(projects, "synthetic-project", "unrelated.jsonl") }),
    env: {
      ...process.env,
      DIRIGENT_STATS_CLAUDE_PROJECTS_DIR: projects,
      DIRIGENT_STATS_CLAUDE_LEDGER_DIR: ledger,
      DIRIGENT_STATS_STATE_DIR: stateDir,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  assert.match(output, /\| orchestrator \| root-model \| 1 \| 20 \| 44\.4% \|/);
  assert.match(output, /\| builder \| worker-model-a, worker-model-b \| 2 \| 20 \| 44\.4% \|/);
  assert.match(output, /\| unknown \| worker-model-c \| 1 \| 5 \| 11\.1% \|/);
  assert.match(output, /\| root-model \| 1 \| 20 \| 44\.4% \|/);
  assert.match(output, /\| worker-model-a \| 1 \| 10 \| 22\.2% \|/);
  assert.match(output, /\| worker-model-b \| 1 \| 10 \| 22\.2% \|/);
  assert.match(output, /\| worker-model-c \| 1 \| 5 \| 11\.1% \|/);
  assert.match(output, /Warning: One or more child transcript identities were unavailable/);
  assert.match(output, /Warning: Some assistant usage records were unavailable/);
  assert.match(output, /Warning: Some assistant usage records lacked stable message IDs/);
  assert.doesNotMatch(output, /unrelated-model|999|100 \||77 \|/);
  assert.doesNotMatch(output, /\| root-model \| 2 \| 120 \|/);
});

test("Claude stats hook fails open for non-trigger and malformed input", () => {
  const script = path.join(root, "plugins", "itixo-claude", "scripts", "dirigent-stats.js");
  for (const input of ["{", JSON.stringify({ prompt: "show stats", session_id: "root-run" })]) {
    const result = spawnSync(process.execPath, [script], { encoding: "utf8", input });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  }
});

test("Stop caches completed reports and explicit stats survives unavailable transcripts", () => {
  const claudeFixture = path.join(root, "tests", "fixtures", "dirigent-stats", "claude");
  const claudeProjects = path.join(claudeFixture, "projects");
  const claudeRoot = path.join(claudeProjects, "synthetic-project", "root-run.jsonl");
  const claudeUnrelated = path.join(claudeProjects, "synthetic-project", "unrelated.jsonl");
  const codexSessions = path.join(root, "tests", "fixtures", "dirigent-stats", "codex", "sessions");
  const cases = [
    {
      plugin: "itixo-claude", sessionId: "root-run", root: claudeRoot, unrelated: claudeUnrelated,
      script: path.join(root, "plugins", "itixo-claude", "scripts", "dirigent-stats.js"),
      env: { DIRIGENT_STATS_CLAUDE_PROJECTS_DIR: claudeProjects, DIRIGENT_STATS_CLAUDE_LEDGER_DIR: path.join(claudeFixture, "ledger") },
    },
    {
      plugin: "itixo-codex", sessionId: "root-rollout", root: path.join(codexSessions, "root.jsonl"), unrelated: path.join(codexSessions, "unrelated.jsonl"),
      script: path.join(root, "plugins", "itixo-codex", "scripts", "dirigent-stats.js"),
      env: { DIRIGENT_STATS_CODEX_SESSIONS_DIR: codexSessions },
    },
  ];
  for (const current of cases) {
    const stateDir = temporaryDirectory();
    startSession(current.plugin, { source: "startup", session_id: current.sessionId, transcript_path: current.root }, stateDir);
    const stopped = stopSession(current.plugin, {
      hook_event_name: "Stop", session_id: current.sessionId, transcript_path: current.root,
      cwd: "/tmp", model: "root-model", turn_id: "completed-turn",
    }, stateDir, current.env);
    assert.equal(stopped.status, 0, stopped.stderr);
    assert.equal(stopped.stderr, "");
    assert.equal(stopped.stdout, "");

    const cached = context(run(current.script, { prompt: "$dirigent-stats", session_id: current.sessionId }, {
      ...current.env, DIRIGENT_STATS_STATE_DIR: stateDir,
    }));
    assert.match(cached, /<!-- (?:itixo-)?dirigent-stats(?:-report)?:?(?:start|begin) -->/);
    assert.match(cached, /root-model|Exact known total/);
    assert.doesNotMatch(cached, /Unavailable: current session stats context is missing or invalid\./);

    const unavailableStorage = path.join(temporaryDirectory(), "missing-session-storage");
    const cachedWithoutTranscript = context(run(current.script, { prompt: "/dirigent-stats", session_id: current.sessionId }, {
      ...current.env,
      DIRIGENT_STATS_STATE_DIR: stateDir,
      ...(current.plugin === "itixo-claude"
        ? { DIRIGENT_STATS_CLAUDE_PROJECTS_DIR: unavailableStorage, DIRIGENT_STATS_CLAUDE_LEDGER_DIR: unavailableStorage }
        : { DIRIGENT_STATS_CODEX_SESSIONS_DIR: unavailableStorage }),
    }));
    assert.equal(cachedWithoutTranscript, cached);
  }
});

test("legacy, corrupt, and missing state self-heal through Stop or one explicit recovery", () => {
  const claudeFixture = path.join(root, "tests", "fixtures", "dirigent-stats", "claude");
  const claudeProjects = path.join(claudeFixture, "projects");
  const codexSessions = path.join(root, "tests", "fixtures", "dirigent-stats", "codex", "sessions");
  const cases = [
    {
      plugin: "itixo-claude", sessionId: "root-run", root: path.join(claudeProjects, "synthetic-project", "root-run.jsonl"),
      script: path.join(root, "plugins", "itixo-claude", "scripts", "dirigent-stats.js"),
      env: { DIRIGENT_STATS_CLAUDE_PROJECTS_DIR: claudeProjects, DIRIGENT_STATS_CLAUDE_LEDGER_DIR: path.join(claudeFixture, "ledger") },
    },
    {
      plugin: "itixo-codex", sessionId: "root-rollout", root: path.join(codexSessions, "root.jsonl"),
      script: path.join(root, "plugins", "itixo-codex", "scripts", "dirigent-stats.js"),
      env: { DIRIGENT_STATS_CODEX_SESSIONS_DIR: codexSessions },
    },
  ];
  for (const current of cases) {
    for (const persisted of ["{\"schema\":1", JSON.stringify({ schema: 1, sessionId: "another-session", transcriptPath: current.root })]) {
      const stateDir = temporaryDirectory();
      startSession(current.plugin, { source: "startup", session_id: current.sessionId, transcript_path: current.root }, stateDir);
      fs.writeFileSync(statePath(stateDir, current.sessionId), persisted);
      const stopped = stopSession(current.plugin, {
        hook_event_name: "Stop", session_id: current.sessionId, transcript_path: current.root,
        cwd: "/tmp", model: "root-model", turn_id: "completed-turn",
      }, stateDir, current.env);
      assert.equal(stopped.status, 0, stopped.stderr);
      assert.equal(stopped.stderr, "");
      assert.equal(stopped.stdout, "");
      const healed = context(run(current.script, { prompt: "/dirigent-stats", session_id: current.sessionId }, {
        ...current.env, DIRIGENT_STATS_STATE_DIR: stateDir,
      }));
      assert.doesNotMatch(healed, /Unavailable: current session stats context is missing or invalid\./);
    }

    const recoveredState = temporaryDirectory();
    const recovered = context(run(current.script, {
      prompt: "$dirigent-stats", session_id: current.sessionId, transcript_path: current.root,
    }, { ...current.env, DIRIGENT_STATS_STATE_DIR: recoveredState }));
    assert.doesNotMatch(recovered, /Unavailable: current session stats context is missing or invalid\./);
    const unavailableStorage = path.join(temporaryDirectory(), "missing-session-storage");
    const cachedRecovery = context(run(current.script, { prompt: "$dirigent-stats", session_id: current.sessionId }, {
      ...current.env,
      DIRIGENT_STATS_STATE_DIR: recoveredState,
      ...(current.plugin === "itixo-claude"
        ? { DIRIGENT_STATS_CLAUDE_PROJECTS_DIR: unavailableStorage, DIRIGENT_STATS_CLAUDE_LEDGER_DIR: unavailableStorage }
        : { DIRIGENT_STATS_CODEX_SESSIONS_DIR: unavailableStorage }),
    }));
    assert.equal(cachedRecovery, recovered);
  }
});

test("Codex resume and compact without transcript_path preserve cached report", () => {
  const fixture = path.join(root, "tests", "fixtures", "dirigent-stats", "codex", "sessions");
  const script = path.join(root, "plugins", "itixo-codex", "scripts", "dirigent-stats.js");
  for (const source of ["resume", "compact"]) {
    const storageRoot = temporaryDirectory();
    const sessions = path.join(storageRoot, "sessions");
    fs.cpSync(fixture, sessions, { recursive: true });
    const transcript = path.join(sessions, "root.jsonl");
    const stateDir = temporaryDirectory();
    startSession("itixo-codex", { source: "startup", session_id: "root-rollout", transcript_path: transcript }, stateDir);
    const stopped = stopSession("itixo-codex", {
      hook_event_name: "Stop", session_id: "root-rollout", transcript_path: transcript,
      cwd: "/tmp", model: "root-model", turn_id: "completed-turn",
    }, stateDir, { DIRIGENT_STATS_CODEX_SESSIONS_DIR: sessions });
    assert.equal(stopped.status, 0, stopped.stderr);
    const cached = context(run(script, { prompt: "$dirigent-stats", session_id: "root-rollout" }, {
      DIRIGENT_STATS_CODEX_SESSIONS_DIR: sessions, DIRIGENT_STATS_STATE_DIR: stateDir,
    }));

    const refreshed = startSession("itixo-codex", { source, session_id: "root-rollout", cwd: "/tmp/resumed" }, stateDir);
    assert.equal(refreshed.status, 0, refreshed.stderr);
    fs.rmSync(storageRoot, { recursive: true, force: true });
    const afterRefresh = context(run(script, { prompt: "/dirigent-stats", session_id: "root-rollout" }, {
      DIRIGENT_STATS_CODEX_SESSIONS_DIR: sessions, DIRIGENT_STATS_STATE_DIR: stateDir,
    }));
    assert.equal(afterRefresh, cached);
  }
});

test("Claude startup and clear reset cache while resume and compact preserve it", () => {
  const fixture = path.join(root, "tests", "fixtures", "dirigent-stats", "claude");
  const script = path.join(root, "plugins", "itixo-claude", "scripts", "dirigent-stats.js");
  const cases = [
    { source: "startup", transcriptPath: undefined, preserved: false },
    { source: "clear", transcriptPath: null, preserved: false },
    { source: "resume", transcriptPath: undefined, preserved: true },
    { source: "compact", transcriptPath: null, preserved: true },
  ];
  for (const current of cases) {
    const storageRoot = temporaryDirectory();
    const copiedFixture = path.join(storageRoot, "claude");
    fs.cpSync(fixture, copiedFixture, { recursive: true });
    const projects = path.join(copiedFixture, "projects");
    const ledger = path.join(copiedFixture, "ledger");
    const transcript = path.join(projects, "synthetic-project", "root-run.jsonl");
    const env = { DIRIGENT_STATS_CLAUDE_PROJECTS_DIR: projects, DIRIGENT_STATS_CLAUDE_LEDGER_DIR: ledger };
    const stateDir = temporaryDirectory();
    startSession("itixo-claude", { source: "startup", session_id: "root-run", transcript_path: transcript }, stateDir);
    const stopped = stopSession("itixo-claude", {
      hook_event_name: "Stop", session_id: "root-run", transcript_path: transcript,
      cwd: "/tmp", model: "root-model", turn_id: "completed-turn",
    }, stateDir, env);
    assert.equal(stopped.status, 0, stopped.stderr);
    const cached = context(run(script, { prompt: "$dirigent-stats", session_id: "root-run" }, {
      ...env, DIRIGENT_STATS_STATE_DIR: stateDir,
    }));
    assert.match(cached, /\| orchestrator \| root-model \|/);

    const refresh = { source: current.source, session_id: "root-run", cwd: "/tmp/refreshed" };
    if (current.transcriptPath === null) refresh.transcript_path = null;
    const refreshed = startSession("itixo-claude", refresh, stateDir);
    assert.equal(refreshed.status, 0, refreshed.stderr);
    fs.rmSync(storageRoot, { recursive: true, force: true });
    const afterRefresh = context(run(script, { prompt: "/dirigent-stats", session_id: "root-run" }, {
      ...env, DIRIGENT_STATS_STATE_DIR: stateDir,
    }));
    const state = JSON.parse(fs.readFileSync(statePath(stateDir, "root-run"), "utf8"));
    if (current.preserved) {
      assert.equal(afterRefresh, cached);
      assert.equal(state.transcriptPath, path.resolve(transcript));
      assert.equal(state.cache.report, cached);
    } else {
      assert.notEqual(afterRefresh, cached);
      assert.doesNotMatch(afterRefresh, /\| orchestrator \| root-model \|/);
      assert.match(afterRefresh, /No exact assistant usage records were available/);
      assert.equal(state.transcriptPath, null);
      assert.equal(state.cache.report, afterRefresh);
    }
  }
});

test("Codex timed-out Stop invalidates prior cached totals", () => {
  const fixture = path.join(root, "tests", "fixtures", "dirigent-stats", "codex", "sessions");
  const storageRoot = temporaryDirectory();
  const sessions = path.join(storageRoot, "sessions");
  fs.cpSync(fixture, sessions, { recursive: true });
  const transcript = path.join(sessions, "root.jsonl");
  const stateDir = temporaryDirectory();
  const script = path.join(root, "plugins", "itixo-codex", "scripts", "dirigent-stats.js");
  startSession("itixo-codex", { source: "startup", session_id: "root-rollout", transcript_path: transcript }, stateDir);
  const initialStop = stopSession("itixo-codex", {
    hook_event_name: "Stop", session_id: "root-rollout", transcript_path: transcript,
    cwd: "/tmp", model: "root-model", turn_id: "initial-turn",
  }, stateDir, { DIRIGENT_STATS_CODEX_SESSIONS_DIR: sessions });
  assert.equal(initialStop.status, 0, initialStop.stderr);
  const prior = context(run(script, { prompt: "$dirigent-stats", session_id: "root-rollout" }, {
    DIRIGENT_STATS_CODEX_SESSIONS_DIR: sessions, DIRIGENT_STATS_STATE_DIR: stateDir,
  }));
  assert.match(prior, /Exact known total: 65 tokens\./);

  const clock = preload(["let now = 0;", "Date.now = () => (now += 1000);"].join("\n"));
  try {
    const timedOut = stopSession("itixo-codex", {
      hook_event_name: "Stop", session_id: "root-rollout", transcript_path: transcript,
      cwd: "/tmp", model: "root-model", turn_id: "timed-out-turn",
    }, stateDir, {
      DIRIGENT_STATS_CODEX_SESSIONS_DIR: sessions,
      DIRIGENT_STATS_STOP_BUDGET_MS: "100",
      NODE_OPTIONS: clock.option,
    });
    assert.equal(timedOut.status, 0, timedOut.stderr);
    assert.equal(timedOut.stderr, "");
    assert.equal(timedOut.stdout, "");
  } finally {
    fs.rmSync(clock.directory, { recursive: true, force: true });
  }
  fs.rmSync(storageRoot, { recursive: true, force: true });

  const current = context(run(script, { prompt: "/dirigent-stats", session_id: "root-rollout" }, {
    DIRIGENT_STATS_CODEX_SESSIONS_DIR: sessions, DIRIGENT_STATS_STATE_DIR: stateDir,
  }));
  assert.notEqual(current, prior);
  assert.doesNotMatch(current, /Exact known total: 65 tokens|root-model|worker-model/);
  assert.match(current, /No completed token usage available yet/);
  assert.match(current, /Exact known total: 0 tokens\./);
  const persisted = JSON.parse(fs.readFileSync(statePath(stateDir, "root-rollout"), "utf8"));
  if (persisted.cache) {
    assert.notEqual(persisted.cache.report, prior);
    assert.equal(persisted.cache.report, current);
    assert.equal(persisted.cache.turnId, "timed-out-turn");
  }
});

test("Codex rejects malformed tagged cached reports instead of emitting them", () => {
  const sessions = path.join(root, "tests", "fixtures", "dirigent-stats", "codex", "sessions");
  const transcript = path.join(sessions, "root.jsonl");
  const script = path.join(root, "plugins", "itixo-codex", "scripts", "dirigent-stats.js");
  const malformedReports = [
    [
      "<!-- dirigent-stats:begin -->",
      "## Dirigent Stats",
      "",
      "Unavailable: current session stats context is missing or invalid.",
      "<!-- dirigent-stats:end -->",
    ].join("\n"),
    "<!-- dirigent-stats:begin -->arbitrary marker string<!-- dirigent-stats:end -->",
  ];
  for (const malformed of malformedReports) {
    const stateDir = temporaryDirectory();
    const file = statePath(stateDir, "root-rollout");
    fs.writeFileSync(file, JSON.stringify({
      schema: 2,
      sessionId: "root-rollout",
      transcriptPath: transcript,
      cwd: "/tmp",
      source: "startup",
      cache: {
        schema: 1,
        sessionId: "root-rollout",
        transcriptPath: transcript,
        report: malformed,
        updatedAt: 1_750_000_000_000,
        turnId: "stale-turn",
      },
    }));
    const recovered = context(run(script, { prompt: "$dirigent-stats", session_id: "root-rollout" }, {
      DIRIGENT_STATS_CODEX_SESSIONS_DIR: sessions, DIRIGENT_STATS_STATE_DIR: stateDir,
    }));
    assert.notEqual(recovered, malformed);
    assert.doesNotMatch(recovered, /Unavailable: current session stats context is missing or invalid|arbitrary marker string/);
    assert.match(recovered, /\| orchestrator \| root-model \| 1 \| 30 \| 46\.2% \|/);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).cache.report, recovered);
  }
});

test("Claude corrupt-state Stop persists a valid cached report from event transcript", () => {
  const fixture = path.join(root, "tests", "fixtures", "dirigent-stats", "claude");
  const storageRoot = temporaryDirectory();
  const copiedFixture = path.join(storageRoot, "claude");
  fs.cpSync(fixture, copiedFixture, { recursive: true });
  const projects = path.join(copiedFixture, "projects");
  const ledger = path.join(copiedFixture, "ledger");
  const transcript = path.join(projects, "synthetic-project", "root-run.jsonl");
  const stateDir = temporaryDirectory();
  const file = statePath(stateDir, "root-run");
  fs.writeFileSync(file, "{\"schema\":1");

  const stopped = stopSession("itixo-claude", {
    hook_event_name: "Stop", session_id: "root-run", transcript_path: transcript,
    cwd: "/tmp", model: "root-model", turn_id: "completed-turn",
  }, stateDir, { DIRIGENT_STATS_CLAUDE_PROJECTS_DIR: projects, DIRIGENT_STATS_CLAUDE_LEDGER_DIR: ledger });
  assert.equal(stopped.status, 0, stopped.stderr);
  assert.equal(stopped.stderr, "");
  assert.equal(stopped.stdout, "");
  const persisted = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(persisted.schema, 2);
  assert.equal(persisted.sessionId, "root-run");
  assert.equal(persisted.transcriptPath, path.resolve(transcript));
  assert.equal(persisted.cache.sessionId, "root-run");
  assert.equal(persisted.cache.transcriptPath, path.resolve(transcript));
  assert.match(persisted.cache.report, /\| orchestrator \| root-model \|/);

  fs.rmSync(storageRoot, { recursive: true, force: true });
  const script = path.join(root, "plugins", "itixo-claude", "scripts", "dirigent-stats.js");
  const cached = context(run(script, { prompt: "$dirigent-stats", session_id: "root-run" }, {
    DIRIGENT_STATS_CLAUDE_PROJECTS_DIR: projects,
    DIRIGENT_STATS_CLAUDE_LEDGER_DIR: ledger,
    DIRIGENT_STATS_STATE_DIR: stateDir,
  }));
  assert.equal(cached, persisted.cache.report);
});

test("valid provider caches perform zero transcript reads", () => {
  const claudeFixture = path.join(root, "tests", "fixtures", "dirigent-stats", "claude");
  const codexFixture = path.join(root, "tests", "fixtures", "dirigent-stats", "codex", "sessions");
  const cases = [
    {
      plugin: "itixo-claude", sessionId: "root-run", fixture: claudeFixture,
      storage: (copy) => path.join(copy, "projects"), transcript: (copy) => path.join(copy, "projects", "synthetic-project", "root-run.jsonl"),
      env: (copy) => ({ DIRIGENT_STATS_CLAUDE_PROJECTS_DIR: path.join(copy, "projects"), DIRIGENT_STATS_CLAUDE_LEDGER_DIR: path.join(copy, "ledger") }),
    },
    {
      plugin: "itixo-codex", sessionId: "root-rollout", fixture: codexFixture,
      storage: (copy) => copy, transcript: (copy) => path.join(copy, "root.jsonl"),
      env: (copy) => ({ DIRIGENT_STATS_CODEX_SESSIONS_DIR: copy }),
    },
  ];
  const sentinel = preload([
    "const fs = require('node:fs');",
    "const original = fs.readFileSync;",
    "fs.readFileSync = function(file, ...args) {",
    "  if (typeof file === 'string' && file.endsWith('.jsonl')) { process.stderr.write('unexpected transcript read'); throw new Error('unexpected transcript read'); }",
    "  return original.call(this, file, ...args);",
    "};",
  ].join("\n"));
  try {
    for (const current of cases) {
      const storageRoot = temporaryDirectory();
      const copy = path.join(storageRoot, "source");
      fs.cpSync(current.fixture, copy, { recursive: true });
      const stateDir = temporaryDirectory();
      const transcript = current.transcript(copy);
      const env = current.env(copy);
      startSession(current.plugin, { source: "startup", session_id: current.sessionId, transcript_path: transcript }, stateDir);
      const stopped = stopSession(current.plugin, {
        hook_event_name: "Stop", session_id: current.sessionId, transcript_path: transcript,
        cwd: "/tmp", model: "root-model", turn_id: "completed-turn",
      }, stateDir, env);
      assert.equal(stopped.status, 0, stopped.stderr);
      const script = path.join(root, "plugins", current.plugin, "scripts", "dirigent-stats.js");
      const before = context(run(script, { prompt: "$dirigent-stats", session_id: current.sessionId }, {
        ...env, DIRIGENT_STATS_STATE_DIR: stateDir,
      }));
      fs.rmSync(current.storage(copy), { recursive: true, force: true });
      const result = run(script, { prompt: "$dirigent-stats", session_id: current.sessionId }, {
        ...env, DIRIGENT_STATS_STATE_DIR: stateDir, NODE_OPTIONS: sentinel.option,
      });
      assert.equal(context(result), before);
    }
  } finally {
    fs.rmSync(sentinel.directory, { recursive: true, force: true });
  }
});

test("Codex atomic writers remove temporary files after rename failure", () => {
  const sessions = path.join(root, "tests", "fixtures", "dirigent-stats", "codex", "sessions");
  const cases = [
    {
      run: (stateDir) => startSession("itixo-codex", {
        source: "startup", session_id: "rename-failure", transcript_path: path.join(sessions, "root.jsonl"),
      }, stateDir),
    },
    {
      run: (stateDir) => stopSession("itixo-codex", {
        hook_event_name: "Stop", session_id: "rename-failure", transcript_path: path.join(sessions, "root.jsonl"),
        cwd: "/tmp", model: "root-model", turn_id: "completed-turn",
      }, stateDir, { DIRIGENT_STATS_CODEX_SESSIONS_DIR: sessions }),
    },
  ];
  for (const current of cases) {
    const stateDir = temporaryDirectory();
    fs.mkdirSync(statePath(stateDir, "rename-failure"));
    const result = current.run(stateDir);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "");
    assert.deepEqual(fs.readdirSync(stateDir).filter((name) => name.endsWith(".tmp")), []);
  }
});

test("Codex budget values normalize to finite bounded behavior", () => {
  const clock = preload([
    "let now = 0;",
    "Date.now = () => (now += 100);",
  ].join("\n"));
  const sessions = temporaryDirectory();
  const transcript = path.join(sessions, "budget-rollout.jsonl");
  fs.writeFileSync(transcript, [
    JSON.stringify({ type: "session_meta", payload: { id: "budget-rollout" } }),
    JSON.stringify({ type: "turn_context", payload: { turn_id: "turn", model: "budget-model" } }),
    JSON.stringify({ type: "event_msg", payload: { turn_id: "turn", info: { total_token_usage: { total_tokens: 7 }, last_token_usage: { total_tokens: 7 } } } }),
  ].join("\n"));
  for (let index = 0; index < 80; index++) {
    fs.writeFileSync(path.join(sessions, `unrelated-${index}.jsonl`), JSON.stringify({ type: "session_meta", payload: { id: `unrelated-${index}` } }));
  }
  const script = path.join(root, "plugins", "itixo-codex", "scripts", "dirigent-stats.js");
  const reportFor = (budget) => {
    const env = {
      DIRIGENT_STATS_CODEX_SESSIONS_DIR: sessions,
      DIRIGENT_STATS_STATE_DIR: temporaryDirectory(),
      NODE_OPTIONS: clock.option,
    };
    if (budget !== undefined) env.DIRIGENT_STATS_STOP_BUDGET_MS = budget;
    return context(run(script, {
      prompt: "$dirigent-stats", session_id: "budget-rollout", transcript_path: transcript,
    }, env));
  };
  try {
    const defaultReport = reportFor(undefined);
    const maximumReport = reportFor("5000");
    assert.match(defaultReport, /Exact known total: 0 tokens\./);
    assert.match(maximumReport, /Exact known total: 0 tokens\./);
    assert.equal(reportFor("not-a-number"), defaultReport);
    assert.equal(reportFor("Infinity"), defaultReport);
    assert.equal(reportFor("999999999999999999999"), maximumReport);
    assert.equal(reportFor("5000.9"), maximumReport);
  } finally {
    fs.rmSync(clock.directory, { recursive: true, force: true });
    fs.rmSync(sessions, { recursive: true, force: true });
  }
});

test("Codex report follows recursive parent_thread_id and final usage snapshots", () => {
  const sessions = path.join(root, "tests", "fixtures", "dirigent-stats", "codex", "sessions");
  const script = path.join(root, "plugins", "itixo-codex", "scripts", "dirigent-stats.js");
  const stateDir = temporaryDirectory();
  startSession("itixo-codex", { source: "startup", session_id: "root-rollout" }, stateDir);
  const stopped = stopSession("itixo-codex", {
    hook_event_name: "Stop", session_id: "root-rollout", transcript_path: path.join(sessions, "root.jsonl"),
    cwd: "/tmp", model: "root-model", turn_id: "completed-turn",
  }, stateDir, { DIRIGENT_STATS_CODEX_SESSIONS_DIR: sessions });
  assert.equal(stopped.status, 0, stopped.stderr);
  assert.equal(stopped.stderr, "");
  assert.equal(stopped.stdout, "");
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    input: JSON.stringify({ prompt: "/dirigent-stats", session_id: "root-rollout", transcript_path: path.join(sessions, "unrelated.jsonl") }),
    env: { ...process.env, DIRIGENT_STATS_CODEX_SESSIONS_DIR: sessions, DIRIGENT_STATS_STATE_DIR: stateDir },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  assert.match(output, /\| orchestrator \| root-model \| 1 \| 30 \| 46\.2% \|/);
  assert.match(output, /\| builder \| worker-model-a, worker-model-b \| 2 \| 35 \| 53\.8% \|/);
  assert.match(output, /\| root-model \| 1 \| 30 \| 46\.2% \|/);
  assert.match(output, /\| worker-model-a \| 1 \| 20 \| 30\.8% \|/);
  assert.match(output, /\| worker-model-b \| 1 \| 15 \| 23\.1% \|/);
  assert.doesNotMatch(output, /\| unknown \||Unmatched exact token remainder/);
  assert.match(output, /Partial report: usage unavailable/);
  assert.doesNotMatch(output, /unrelated-model|999/);
});

test("Codex sums distinct incremental usage events within one turn", () => {
  const sessions = path.join(root, "tests", "fixtures", "dirigent-stats", "codex", "sessions");
  const script = path.join(root, "plugins", "itixo-codex", "scripts", "dirigent-stats.js");
  const stateDir = temporaryDirectory();
  startSession("itixo-codex", { source: "startup", session_id: "incremental-rollout" }, stateDir);
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    input: JSON.stringify({ prompt: "$dirigent-stats", session_id: "incremental-rollout" }),
    env: { ...process.env, DIRIGENT_STATS_CODEX_SESSIONS_DIR: sessions, DIRIGENT_STATS_STATE_DIR: stateDir },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  assert.match(output, /\| orchestrator \| incremental-model \| 1 \| 30 \| 100\.0% \|/);
  assert.match(output, /\| incremental-model \| 1 \| 30 \| 100\.0% \|/);
  assert.match(output, /Exact known total: 30 tokens\./);
  assert.doesNotMatch(output, /\| unknown \||Unmatched exact token remainder|777/);
});

test("Codex warns when cumulative usage resets", () => {
  const sessions = path.join(root, "tests", "fixtures", "dirigent-stats", "codex", "sessions");
  const script = path.join(root, "plugins", "itixo-codex", "scripts", "dirigent-stats.js");
  const stateDir = temporaryDirectory();
  startSession("itixo-codex", { source: "startup", session_id: "reset-rollout" }, stateDir);
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    input: JSON.stringify({ prompt: "/dirigent-stats", session_id: "reset-rollout" }),
    env: { ...process.env, DIRIGENT_STATS_CODEX_SESSIONS_DIR: sessions, DIRIGENT_STATS_STATE_DIR: stateDir },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  assert.match(output, /Cumulative token usage reset; pre-reset model attribution is unavailable/);
  assert.match(output, /\| post-reset-model \| 1 \| 12 \| 100\.0% \|/);
  assert.doesNotMatch(output, /\| unknown \||Unmatched exact token remainder/);
  assert.doesNotMatch(output, /\| pre-reset-model \|/);
});

test("Codex stats hook fails open for non-trigger and malformed input", () => {
  const script = path.join(root, "plugins", "itixo-codex", "scripts", "dirigent-stats.js");
  for (const input of ["{", JSON.stringify({ prompt: "stats" })]) {
    const result = spawnSync(process.execPath, [script], { encoding: "utf8", input });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  }
});

function otelSpan({ traceId, spanId, parentSpanId, name, sessionId, agent, model, input, output, cache }) {
  return {
    type: "span", traceId, spanId, parentSpanId, name,
    attributes: {
      "gen_ai.conversation.id": sessionId,
      "gen_ai.agent.name": agent,
      "gen_ai.request.model": model,
      "gen_ai.usage.input_tokens": input,
      "gen_ai.usage.output_tokens": output,
      "gen_ai.usage.cache_read_input_tokens": cache,
    },
  };
}

function writeCopilotTelemetry(lines) {
  const directory = temporaryDirectory();
  const file = path.join(directory, "copilot-otel.jsonl");
  fs.writeFileSync(file, lines.map((line) => typeof line === "string" ? line : JSON.stringify(line)).join("\n") + "\n");
  return { directory, file };
}

function copilotStats(input, telemetryPath) {
  return spawnSync(process.execPath, [path.join(root, "plugins", "itixo-copilot", "scripts", "dirigent-stats.js")], {
    encoding: "utf8",
    input: JSON.stringify(input),
    env: telemetryPath === undefined ? process.env : { ...process.env, COPILOT_OTEL_FILE_EXPORTER_PATH: telemetryPath },
  });
}

function copilotContext(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout).modifiedTransformedPrompt;
}

function copilotStatsConcurrently(input, telemetryPath) {
  const child = spawn(process.execPath, [path.join(root, "plugins", "itixo-copilot", "scripts", "dirigent-stats.js")], {
    env: { ...process.env, COPILOT_OTEL_FILE_EXPORTER_PATH: telemetryPath },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end(JSON.stringify(input));
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

test("Copilot derives exact OTel stats only for userPromptTransformed sessionId", async () => {
  const rootId = "0123456789abcdef";
  const telemetry = writeCopilotTelemetry([
    otelSpan({ traceId: "a".repeat(32), spanId: rootId, name: "invoke_agent", sessionId: "copilot-root", agent: "orchestrator", model: "root-model", input: 0, output: 0, cache: 0 }),
    otelSpan({ traceId: "a".repeat(32), spanId: "1010101010101010", parentSpanId: rootId, name: "chat", sessionId: "copilot-root", agent: "orchestrator", model: "root-model", input: 11, output: 5, cache: 3 }),
    otelSpan({ traceId: "a".repeat(32), spanId: "1111111111111111", parentSpanId: rootId, name: "invoke_agent", sessionId: "copilot-root", agent: "builder", model: "builder-model", input: 0, output: 0, cache: 0 }),
    otelSpan({ traceId: "a".repeat(32), spanId: "1111111111111112", parentSpanId: "1111111111111111", name: "chat", sessionId: "copilot-root", agent: "builder", model: "builder-model", input: 7, output: 13, cache: 2 }),
    otelSpan({ traceId: "a".repeat(32), spanId: "1212121212121212", parentSpanId: "1111111111111111", name: "invoke_agent", sessionId: "copilot-root", agent: "reviewer", model: "reviewer-model", input: 0, output: 0, cache: 0 }),
    otelSpan({ traceId: "a".repeat(32), spanId: "1212121212121213", parentSpanId: "1212121212121212", name: "chat", sessionId: "copilot-root", agent: "reviewer", model: "reviewer-model", input: 3, output: 2, cache: 1 }),
    // Repeated exporter record must not count the same span twice.
    otelSpan({ traceId: "a".repeat(32), spanId: "1111111111111112", parentSpanId: "1111111111111111", name: "chat", sessionId: "copilot-root", agent: "builder", model: "builder-model", input: 7, output: 13, cache: 2 }),
    // Same trace but no ancestry and a separate session are excluded.
    otelSpan({ traceId: "a".repeat(32), spanId: "2222222222222222", name: "chat", sessionId: "other-session", agent: "leak", model: "leak-model", input: 999, output: 999, cache: 999 }),
  ]);
  try {
    const result = copilotStats({ hookEventName: "userPromptTransformed", sessionId: "copilot-root", prompt: "/itixo-copilot/dirigent-stats", transformedPrompt: "/itixo-copilot/dirigent-stats" }, telemetry.file);
    const output = copilotContext(result);
    assert.match(output, /<!-- itixo-dirigent-stats-report:start -->/);
    assert.match(output, /\| Agent \| Model \| Runs \| Input \| Output \| Cache Read \| Cache Create \| Tokens \|/);
    assert.match(output, /\| orchestrator \| root-model \| 1 \| 11 \| 5 \| 3 \| 0 \| 16 \|/);
    assert.match(output, /\| builder \| builder-model \| 1 \| 7 \| 13 \| 2 \| 0 \| 20 \|/);
    assert.match(output, /\| reviewer \| reviewer-model \| 1 \| 3 \| 2 \| 1 \| 0 \| 5 \|/);
    assert.match(output, /\| root-model \| 1 \| 11 \| 5 \| 3 \| 0 \| 16 \|/);
    assert.match(output, /\| builder-model \| 1 \| 7 \| 13 \| 2 \| 0 \| 20 \|/);
    assert.match(output, /\| reviewer-model \| 1 \| 3 \| 2 \| 1 \| 0 \| 5 \|/);
    assert.match(output, /Exact recorded total: 41 tokens\./);
    assert.match(output, /Cache values are recorded separately and are not added to Tokens/);
    assert.doesNotMatch(output, /leak-model|999/);
    const concurrent = await Promise.all(Array.from({ length: 10 }, () => copilotStatsConcurrently(
      { hookEventName: "userPromptTransformed", sessionId: "copilot-root", prompt: "/itixo-copilot/dirigent-stats", transformedPrompt: "/itixo-copilot/dirigent-stats" }, telemetry.file,
    )));
    for (const response of concurrent) assert.match(copilotContext(response), /Exact recorded total: 41 tokens\./);
  } finally {
    fs.rmSync(telemetry.directory, { recursive: true, force: true });
  }
});

test("Copilot stats exact-name routing and invalid OTel inputs fail open", () => {
  const unavailable = "Unavailable: exact current-session Copilot telemetry is absent, invalid, or cannot be correlated.";
  const telemetry = writeCopilotTelemetry([
    "{", // malformed JSONL is ignored, never emitted.
    JSON.stringify({ resourceSpans: "invalid" }),
    otelSpan({ traceId: "b".repeat(32), spanId: "3333333333333333", name: "invoke_agent", sessionId: "copilot-root", agent: "orchestrator", model: "bad-model", input: 0, output: 0, cache: 0 }),
    otelSpan({ traceId: "b".repeat(32), spanId: "3333333333333334", parentSpanId: "3333333333333333", name: "chat", sessionId: "copilot-root", agent: "orchestrator", model: "bad-model", input: -1, output: 1.5, cache: 0 }),
    // A second matching root on another trace makes correlation ambiguous.
    otelSpan({ traceId: "c".repeat(32), spanId: "4444444444444444", name: "invoke_agent", sessionId: "copilot-root", agent: "builder", model: "ambiguous-model", input: 1, output: 1, cache: 0 }),
  ]);
  try {
    for (const prompt of ["/dirigent-stats", "$dirigent-stats", "/itixo-copilot/dirigent-stats-now", "show /itixo-copilot/dirigent-stats please"]) {
      const result = copilotStats({ hookEventName: "userPromptTransformed", sessionId: "copilot-root", prompt, transformedPrompt: prompt }, telemetry.file);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, "", `must pass through '${prompt}'`);
    }
    const exactEvent = { hookEventName: "userPromptTransformed", sessionId: "copilot-root", prompt: "/itixo-copilot/dirigent-stats", transformedPrompt: "/itixo-copilot/dirigent-stats" };
    assert.match(copilotContext(copilotStats(exactEvent, telemetry.file)), new RegExp(unavailable.replaceAll(".", "\\.")));
    assert.match(copilotContext(copilotStats(exactEvent)), new RegExp(unavailable.replaceAll(".", "\\.")));
    assert.match(copilotContext(copilotStats(exactEvent, path.join(telemetry.directory, "missing.jsonl"))), new RegExp(unavailable.replaceAll(".", "\\.")));
  } finally {
    fs.rmSync(telemetry.directory, { recursive: true, force: true });
  }
});

test("Copilot aggregates separate current-session invoke_agent trace trees", () => {
  const telemetry = writeCopilotTelemetry([
    otelSpan({ traceId: "d".repeat(32), spanId: "ddddddddddddddd1", name: "invoke_agent", sessionId: "copilot-multi", agent: "orchestrator", model: "root-model", input: 0, output: 0, cache: 0 }),
    otelSpan({ traceId: "d".repeat(32), spanId: "ddddddddddddddd2", parentSpanId: "ddddddddddddddd1", name: "chat", sessionId: "copilot-multi", agent: "orchestrator", model: "root-model", input: 2, output: 3, cache: 5 }),
    otelSpan({ traceId: "e".repeat(32), spanId: "eeeeeeeeeeeeeee1", name: "invoke_agent", sessionId: "copilot-multi", agent: "builder", model: "builder-model", input: 0, output: 0, cache: 0 }),
    otelSpan({ traceId: "e".repeat(32), spanId: "eeeeeeeeeeeeeee2", parentSpanId: "eeeeeeeeeeeeeee1", name: "chat", sessionId: "copilot-multi", agent: "builder", model: "builder-model", input: 7, output: 11, cache: 13 }),
  ]);
  try {
    const output = copilotContext(copilotStats({
      hookEventName: "userPromptTransformed", sessionId: "copilot-multi", prompt: "/itixo-copilot/dirigent-stats", transformedPrompt: "/itixo-copilot/dirigent-stats",
    }, telemetry.file));
    assert.match(output, /\| orchestrator \| root-model \| 1 \| 2 \| 3 \| 5 \| 0 \| 5 \|/);
    assert.match(output, /\| builder \| builder-model \| 1 \| 7 \| 11 \| 13 \| 0 \| 18 \|/);
    assert.match(output, /\| root-model \| 1 \| 2 \| 3 \| 5 \| 0 \| 5 \|/);
    assert.match(output, /\| builder-model \| 1 \| 7 \| 11 \| 13 \| 0 \| 18 \|/);
    assert.match(output, /Exact recorded total: 23 tokens\./);
    assert.match(output, /Cache values are recorded separately and are not added to Tokens/);
  } finally {
    fs.rmSync(telemetry.directory, { recursive: true, force: true });
  }
});

test("Copilot fails closed for malformed spans but ignores metric and log records", () => {
  const unavailable = /Unavailable: exact current-session Copilot telemetry is absent, invalid, or cannot be correlated\./;
  const validTree = [
    otelSpan({ traceId: "f".repeat(32), spanId: "fffffffffffffff1", name: "invoke_agent", sessionId: "copilot-malformed", agent: "orchestrator", model: "root-model", input: 0, output: 0, cache: 0 }),
    otelSpan({ traceId: "f".repeat(32), spanId: "fffffffffffffff2", parentSpanId: "fffffffffffffff1", name: "chat", sessionId: "copilot-malformed", agent: "orchestrator", model: "root-model", input: 4, output: 6, cache: 8 }),
  ];
  const event = {
    hookEventName: "userPromptTransformed", sessionId: "copilot-malformed", prompt: "/itixo-copilot/dirigent-stats", transformedPrompt: "/itixo-copilot/dirigent-stats",
  };
  const ignored = writeCopilotTelemetry([...validTree, { type: "metric", name: "process.cpu", value: 999 }, { type: "log", body: "unrelated" }]);
  try {
    const output = copilotContext(copilotStats(event, ignored.file));
    assert.match(output, /Exact recorded total: 10 tokens\./);
    assert.doesNotMatch(output, /999|process\.cpu|unrelated/);
  } finally {
    fs.rmSync(ignored.directory, { recursive: true, force: true });
  }
  for (const malformed of [
    { type: "span", traceId: "f".repeat(32), name: "chat", attributes: {} },
    { type: "span", traceId: "f".repeat(32), spanId: "fffffffffffffff3", attributes: {} },
    { type: "span", traceId: "f".repeat(32), spanId: "fffffffffffffff4", name: "chat" },
    // Same stable ID with conflicting parentage must never be attributed speculatively.
    { ...validTree[1], parentSpanId: "fffffffffffffff9" },
  ]) {
    const telemetry = writeCopilotTelemetry([...validTree, malformed]);
    try {
      assert.match(copilotContext(copilotStats(event, telemetry.file)), unavailable);
    } finally {
      fs.rmSync(telemetry.directory, { recursive: true, force: true });
    }
  }
});

test("Copilot rejects present invalid or conflicting token attributes", () => {
  const unavailable = /Unavailable: exact current-session Copilot telemetry is absent, invalid, or cannot be correlated\./;
  const event = {
    hookEventName: "userPromptTransformed", sessionId: "copilot-token-validation", prompt: "/itixo-copilot/dirigent-stats", transformedPrompt: "/itixo-copilot/dirigent-stats",
  };
  const validTree = () => [
    otelSpan({ traceId: "g".repeat(32), spanId: "ggggggggggggggg1", name: "invoke_agent", sessionId: event.sessionId, agent: "orchestrator", model: "root-model", input: 0, output: 0, cache: 0 }),
    otelSpan({ traceId: "g".repeat(32), spanId: "ggggggggggggggg2", parentSpanId: "ggggggggggggggg1", name: "chat", sessionId: event.sessionId, agent: "orchestrator", model: "root-model", input: 4, output: 6, cache: 8 }),
  ];
  const invalidValues = [
    ["negative", -1],
    ["fractional", 1.5],
    ["non-number", "invalid"],
  ];
  const tokenAttributes = [
    "gen_ai.usage.input_tokens",
    "gen_ai.usage.output_tokens",
    "gen_ai.usage.cache_read_input_tokens",
    "gen_ai.usage.cache_creation_tokens",
  ];

  for (const attribute of tokenAttributes) {
    for (const [kind, value] of invalidValues) {
      const tree = validTree();
      tree[1].attributes[attribute] = value;
      const telemetry = writeCopilotTelemetry(tree);
      try {
        assert.match(copilotContext(copilotStats(event, telemetry.file)), unavailable, `${attribute} ${kind}`);
      } finally {
        fs.rmSync(telemetry.directory, { recursive: true, force: true });
      }
    }
  }

  for (const [first, second] of [
    ["gen_ai.usage.input_tokens", "gen_ai.usage.prompt_tokens"],
    ["gen_ai.usage.output_tokens", "gen_ai.usage.completion_tokens"],
    ["gen_ai.usage.cache_read_tokens", "gen_ai.usage.cache_read_input_tokens"],
    ["gen_ai.usage.cache_creation_tokens", "gen_ai.usage.cache_write_tokens"],
  ]) {
    const tree = validTree();
    tree[1].attributes[first] = 17;
    tree[1].attributes[second] = 19;
    const telemetry = writeCopilotTelemetry(tree);
    try {
      assert.match(copilotContext(copilotStats(event, telemetry.file)), unavailable, `${first} conflicts with ${second}`);
    } finally {
      fs.rmSync(telemetry.directory, { recursive: true, force: true });
    }
  }
});

test("Copilot treats absent optional cache attributes as exact zero", () => {
  const event = {
    hookEventName: "userPromptTransformed", sessionId: "copilot-no-cache", prompt: "/itixo-copilot/dirigent-stats", transformedPrompt: "/itixo-copilot/dirigent-stats",
  };
  const root = otelSpan({ traceId: "h".repeat(32), spanId: "hhhhhhhhhhhhhhh1", name: "invoke_agent", sessionId: event.sessionId, agent: "orchestrator", model: "root-model", input: 0, output: 0, cache: undefined });
  const chat = otelSpan({ traceId: "h".repeat(32), spanId: "hhhhhhhhhhhhhhh2", parentSpanId: "hhhhhhhhhhhhhhh1", name: "chat", sessionId: event.sessionId, agent: "orchestrator", model: "root-model", input: 12, output: 9, cache: undefined });
  const telemetry = writeCopilotTelemetry([root, chat]);
  try {
    const output = copilotContext(copilotStats(event, telemetry.file));
    assert.match(output, /\| orchestrator \| root-model \| 1 \| 12 \| 9 \| 0 \| 0 \| 21 \|/);
    assert.match(output, /Exact recorded total: 21 tokens\./);
  } finally {
    fs.rmSync(telemetry.directory, { recursive: true, force: true });
  }
});

test("Copilot requires counted chat input and output token attributes", () => {
  const unavailable = /Unavailable: exact current-session Copilot telemetry is absent, invalid, or cannot be correlated\./;
  const event = {
    hookEventName: "userPromptTransformed", sessionId: "copilot-required-tokens", prompt: "/itixo-copilot/dirigent-stats", transformedPrompt: "/itixo-copilot/dirigent-stats",
  };
  const validTree = () => [
    otelSpan({ traceId: "i".repeat(32), spanId: "iiiiiiiiiiiiiii1", name: "invoke_agent", sessionId: event.sessionId, agent: "orchestrator", model: "root-model", input: 0, output: 0, cache: undefined }),
    otelSpan({ traceId: "i".repeat(32), spanId: "iiiiiiiiiiiiiii2", parentSpanId: "iiiiiiiiiiiiiii1", name: "chat", sessionId: event.sessionId, agent: "orchestrator", model: "root-model", input: 0, output: 0, cache: undefined }),
  ];
  const required = [
    ["input", ["gen_ai.usage.input_tokens"]],
    ["output", ["gen_ai.usage.output_tokens"]],
    ["input and output", ["gen_ai.usage.input_tokens", "gen_ai.usage.output_tokens"]],
  ];

  const validTelemetry = writeCopilotTelemetry(validTree());
  try {
    const output = copilotContext(copilotStats(event, validTelemetry.file));
    assert.match(output, /\| orchestrator \| root-model \| 1 \| 0 \| 0 \| 0 \| 0 \| 0 \|/);
    assert.match(output, /Exact recorded total: 0 tokens\./);
  } finally {
    fs.rmSync(validTelemetry.directory, { recursive: true, force: true });
  }

  for (const [label, attributes] of required) {
    const tree = validTree();
    for (const attribute of attributes) delete tree[1].attributes[attribute];
    const telemetry = writeCopilotTelemetry(tree);
    try {
      assert.match(copilotContext(copilotStats(event, telemetry.file)), unavailable, `missing ${label}`);
    } finally {
      fs.rmSync(telemetry.directory, { recursive: true, force: true });
    }
  }

  const aliasTree = validTree();
  delete aliasTree[1].attributes["gen_ai.usage.input_tokens"];
  delete aliasTree[1].attributes["gen_ai.usage.output_tokens"];
  aliasTree[1].attributes["gen_ai.usage.prompt_tokens"] = 2;
  aliasTree[1].attributes["gen_ai.usage.completion_tokens"] = 3;
  const aliasTelemetry = writeCopilotTelemetry(aliasTree);
  try {
    const output = copilotContext(copilotStats(event, aliasTelemetry.file));
    assert.match(output, /\| orchestrator \| root-model \| 1 \| 2 \| 3 \| 0 \| 0 \| 5 \|/);
    assert.match(output, /Exact recorded total: 5 tokens\./);
  } finally {
    fs.rmSync(aliasTelemetry.directory, { recursive: true, force: true });
  }
});
