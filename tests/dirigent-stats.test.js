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
  assert.equal(marker.schema, 1);
  assert.equal(marker.sessionId, sessionId);
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
      assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), {
        schema: 1, sessionId, transcriptPath: path.resolve(`/tmp/${source}.jsonl`), cwd: "/tmp", source,
      });
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

test("hashed marker paths contain traversal IDs and corrupt state is unavailable", () => {
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

    startSession(current.plugin, { source: "startup", session_id: current.sessionId, transcript_path: current.root }, stateDir);
    for (const persisted of ["{\"schema\":1", JSON.stringify({ schema: 1, sessionId: "another-session", transcriptPath: current.root })]) {
      fs.writeFileSync(statePath(stateDir, current.sessionId), persisted);
      const output = context(run(current.script, { prompt: "/dirigent-stats", session_id: current.sessionId }, {
        ...current.env, DIRIGENT_STATS_STATE_DIR: stateDir,
      }));
      assert.match(output, /Unavailable: current session stats context is missing or invalid\./);
      assert.doesNotMatch(output, /root-model|Exact known total/);
    }
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

test("explicit stats reports require same-session marker and never borrow another transcript", () => {
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
    const missingState = temporaryDirectory();
    const missing = context(run(current.script, { prompt: "/dirigent-stats", session_id: current.sessionId }, {
      ...current.env, DIRIGENT_STATS_STATE_DIR: missingState,
    }));
    assert.match(missing, /<!-- (?:itixo-)?dirigent-stats(?:-report)?:?(?:start|begin) -->/);
    assert.match(missing, /Unavailable: current session stats context is missing or invalid\./);

    const mismatchState = temporaryDirectory();
    startSession(current.plugin, { source: "resume", session_id: current.sessionId, transcript_path: current.unrelated }, mismatchState);
    const mismatched = context(run(current.script, {
      prompt: "$dirigent-stats", session_id: current.sessionId, transcript_path: current.root,
    }, { ...current.env, DIRIGENT_STATS_STATE_DIR: mismatchState }));
    assert.match(mismatched, /Unavailable: current session stats context is missing or invalid\./);
    assert.doesNotMatch(mismatched, /root-model|unrelated-model|Exact known total/);
  }
});

test("Codex report follows recursive parent_thread_id and final usage snapshots", () => {
  const sessions = path.join(root, "tests", "fixtures", "dirigent-stats", "codex", "sessions");
  const script = path.join(root, "plugins", "itixo-codex", "scripts", "dirigent-stats.js");
  const stateDir = temporaryDirectory();
  startSession("itixo-codex", { source: "startup", session_id: "root-rollout" }, stateDir);
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
