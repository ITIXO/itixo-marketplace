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

const INVALID_VIEW = "Invalid stats view. Use agents, models, or both.";
const AGENT_USAGE_HEADER = "| Agent | Model | Runs | Usage | Share |";
const MODEL_USAGE_HEADER = "| Model | Runs | Usage | Share |";

function writeJsonl(file, records) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, records.map((record) => JSON.stringify(record)).join("\n"));
}

function assertView(report, view) {
  const lines = new Set(report.split("\n"));
  assert.equal(lines.has(AGENT_USAGE_HEADER), view !== "models", report);
  assert.equal(lines.has(MODEL_USAGE_HEADER), view !== "agents", report);
}

function markdownRows(report, header) {
  const lines = report.split("\n");
  const start = lines.indexOf(header);
  assert.notEqual(start, -1, report);
  const rows = [];
  for (let index = start + 2; index < lines.length && lines[index].startsWith("|"); index += 1) {
    rows.push(lines[index].split("|").slice(1, -1).map((cell) => cell.trim()));
  }
  return rows;
}

function kToks(value) {
  return Number(value.replace(/,/g, "").replace(/ kToks$/, ""));
}

function assertUsageInvariant(report) {
  const totalMatch = report.match(/Exact known total: ([\d,.]+ kToks)\./);
  assert.ok(totalMatch, report);
  const total = kToks(totalMatch[1]);
  const agentSum = markdownRows(report, AGENT_USAGE_HEADER)
    .reduce((sum, row) => sum + kToks(row[3]), 0);
  const modelSum = markdownRows(report, MODEL_USAGE_HEADER)
    .reduce((sum, row) => sum + kToks(row[2]), 0);
  assert.equal(agentSum, total);
  assert.equal(modelSum, total);
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

test("dirigent-stats metadata and report contracts stay aligned across providers", () => {
  assert.equal(read(plugins[0], metadataRel), read(plugins[1], metadataRel));
  for (const plugin of plugins) {
    const skill = read(plugin, skillRel);
    assert.match(skill, /`--view agents\|models\|both`/);
    assert.match(skill, /default to `both`/);
    assert.match(skill, /exactly `Invalid stats view\. Use agents, models, or both\.`/);
    assert.match(skill, /exactly `No token usage available yet\.`/);
    assert.match(skill, /exact `kToks`/);
    assert.match(skill, /never convert to `mToks`/);
  }
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
  const codexSkill = read("itixo-codex", skillRel);
  for (const pattern of [
    /selected cached report/i,
    /verbatim/i,
    /never recalculate, estimate, or double-sum/i,
    /at most three decimals/i,
  ]) {
    assert.match(codexSkill, pattern);
  }
  assert.match(codexSkill, /root orchestrator plus recursive agents/i);
  assert.match(codexSkill, /If usage is unavailable or zero, return exactly `No token usage available yet\.`/i);
  assert.match(codexSkill, /alternate groupings of the same total/i);
});

test("Codex no-data output is exactly the plain user fallback", () => {
  const sessions = temporaryDirectory();
  const stateDir = temporaryDirectory();
  const script = path.join(root, "plugins", "itixo-codex", "scripts", "dirigent-stats.js");
  startSession("itixo-codex", { source: "startup", session_id: "empty-rollout" }, stateDir);

  const output = context(run(script, { prompt: "$dirigent-stats", session_id: "empty-rollout" }, {
    DIRIGENT_STATS_CODEX_SESSIONS_DIR: sessions,
    DIRIGENT_STATS_STATE_DIR: stateDir,
  }));

  assert.equal(output, "No token usage available yet.");
  assert.doesNotMatch(output, /\||## |<!--|Instruction:|Snapshot:/);
});

test("Codex nonzero output keeps human report data without transport metadata", () => {
  const sessions = path.join(root, "tests", "fixtures", "dirigent-stats", "codex", "sessions");
  const transcript = path.join(sessions, "root.jsonl");
  const stateDir = temporaryDirectory();
  const script = path.join(root, "plugins", "itixo-codex", "scripts", "dirigent-stats.js");
  startSession("itixo-codex", { source: "startup", session_id: "root-rollout", transcript_path: transcript }, stateDir);
  const stopped = stopSession("itixo-codex", {
    hook_event_name: "Stop", session_id: "root-rollout", transcript_path: transcript,
    cwd: "/tmp", model: "root-model", turn_id: "completed-turn",
  }, stateDir, { DIRIGENT_STATS_CODEX_SESSIONS_DIR: sessions });
  assert.equal(stopped.status, 0, stopped.stderr);

  const output = context(run(script, { prompt: "$dirigent-stats", session_id: "root-rollout" }, {
    DIRIGENT_STATS_CODEX_SESSIONS_DIR: sessions,
    DIRIGENT_STATS_STATE_DIR: stateDir,
  }));

  assert.match(output, /^## Dirigent Stats$/m);
  assert.match(output, /^\| Agent \| Model \| Runs \| Usage \| Share \|$/m);
  assert.match(output, /^\| Model \| Runs \| Usage \| Share \|$/m);
  assert.match(output, /Exact known total: 0\.065 kToks\./);
  assert.match(output, /Partial report: usage unavailable/);
  assert.doesNotMatch(output, /<!--|Instruction:|Snapshot:/);
});

test("Codex Stop resolves and anchors a null-state transcript within its bounded budget", () => {
  const sessions = temporaryDirectory();
  const stateDir = temporaryDirectory();
  const sessionId = "bounded-rollout";
  const transcript = path.join(sessions, "zzz-matching-rollout.jsonl");
  for (let index = 0; index < 48; index++) {
    const decoy = path.join(sessions, `decoy-${String(index).padStart(3, "0")}.jsonl`);
    fs.writeFileSync(decoy, JSON.stringify({ type: "session_meta", payload: { id: `decoy-${index}` } }));
    fs.utimesSync(decoy, new Date(0), new Date(0));
  }
  fs.writeFileSync(transcript, [
    JSON.stringify({ type: "session_meta", payload: { id: sessionId } }),
    JSON.stringify({ type: "turn_context", payload: { turn_id: "turn", model: "bounded-model" } }),
    JSON.stringify({ type: "event_msg", payload: { turn_id: "turn", info: { total_token_usage: { total_tokens: 42 }, last_token_usage: { total_tokens: 42 } } } }),
  ].join("\n"));
  fs.writeFileSync(statePath(stateDir, sessionId), JSON.stringify({
    schema: 2, sessionId, transcriptPath: null, cwd: "/tmp", source: "startup",
  }));
  const clock = preload(["let now = 0;", "Date.now = () => (now += 5);"].join("\n"));
  try {
    const stopped = stopSession("itixo-codex", {
      hook_event_name: "Stop", session_id: sessionId, cwd: "/tmp", model: "bounded-model", turn_id: "completed-turn",
    }, stateDir, {
      DIRIGENT_STATS_CODEX_SESSIONS_DIR: sessions,
      DIRIGENT_STATS_STOP_BUDGET_MS: "100",
      NODE_OPTIONS: clock.option,
    });
    assert.equal(stopped.status, 0, stopped.stderr);
    const output = context(run(
      path.join(root, "plugins", "itixo-codex", "scripts", "dirigent-stats.js"),
      { prompt: "$dirigent-stats", session_id: sessionId },
      { DIRIGENT_STATS_CODEX_SESSIONS_DIR: sessions, DIRIGENT_STATS_STATE_DIR: stateDir },
    ));
    assert.match(output, /Exact known total: 0\.042 kToks\./);
    assert.doesNotMatch(output, /No token usage available yet|Exact known total: 0 kToks/);
    const persisted = JSON.parse(fs.readFileSync(statePath(stateDir, sessionId), "utf8"));
    assert.equal(persisted.transcriptPath, path.resolve(transcript));
    assert.equal(persisted.cache.transcriptPath, path.resolve(transcript));
  } finally {
    fs.rmSync(clock.directory, { recursive: true, force: true });
  }
});

test("Codex Stop never caches an old resolved report under a newer SessionStart anchor", () => {
  const sessions = temporaryDirectory();
  const stateDir = temporaryDirectory();
  const sessionId = "anchor-race-rollout";
  const oldTranscript = path.join(sessions, "old.jsonl");
  const newTranscript = path.join(sessions, "new.jsonl");
  fs.writeFileSync(oldTranscript, [
    JSON.stringify({ type: "session_meta", payload: { id: sessionId } }),
    JSON.stringify({ type: "turn_context", payload: { turn_id: "old-turn", model: "old-model" } }),
    JSON.stringify({ type: "event_msg", payload: { turn_id: "old-turn", info: { total_token_usage: { total_tokens: 31 }, last_token_usage: { total_tokens: 31 } } } }),
  ].join("\n"));
  fs.writeFileSync(newTranscript, JSON.stringify({ type: "session_meta", payload: { id: sessionId } }));
  fs.writeFileSync(statePath(stateDir, sessionId), JSON.stringify({
    schema: 2, sessionId, transcriptPath: null, cwd: "/tmp/old", source: "startup",
  }));

  const race = preload([
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const originalRead = fs.readFileSync;",
    "let injected = false;",
    "fs.readFileSync = function(file, ...args) {",
    "  const value = originalRead.call(this, file, ...args);",
    "  if (!injected && path.resolve(String(file)) === path.resolve(process.env.RACE_OLD_TRANSCRIPT)) {",
    "    injected = true;",
    "    fs.writeFileSync(process.env.RACE_STATE_FILE, JSON.stringify({",
    "      schema: 2, sessionId: process.env.RACE_SESSION_ID, transcriptPath: path.resolve(process.env.RACE_NEW_TRANSCRIPT),",
    "      cwd: '/tmp/new', source: 'resume'",
    "    }));",
    "  }",
    "  return value;",
    "};",
  ].join("\n"));
  try {
    const stopped = stopSession("itixo-codex", {
      hook_event_name: "Stop", session_id: sessionId, transcript_path: oldTranscript,
      cwd: "/tmp/old", model: "old-model", turn_id: "old-turn",
    }, stateDir, {
      DIRIGENT_STATS_CODEX_SESSIONS_DIR: sessions,
      NODE_OPTIONS: race.option,
      RACE_STATE_FILE: statePath(stateDir, sessionId),
      RACE_SESSION_ID: sessionId,
      RACE_OLD_TRANSCRIPT: oldTranscript,
      RACE_NEW_TRANSCRIPT: newTranscript,
    });
    assert.equal(stopped.status, 0, stopped.stderr);
    const output = context(run(
      path.join(root, "plugins", "itixo-codex", "scripts", "dirigent-stats.js"),
      { prompt: "$dirigent-stats", session_id: sessionId },
      { DIRIGENT_STATS_CODEX_SESSIONS_DIR: sessions, DIRIGENT_STATS_STATE_DIR: stateDir },
    ));
    assert.equal(output, "No token usage available yet.");
    const persisted = JSON.parse(fs.readFileSync(statePath(stateDir, sessionId), "utf8"));
    assert.equal(persisted.transcriptPath, path.resolve(newTranscript));
    assert.doesNotMatch(persisted.cache?.report || "", /31 tokens|old-model/);
  } finally {
    fs.rmSync(race.directory, { recursive: true, force: true });
  }
});

test("Codex candidate prioritization stops stat work at the deterministic deadline", () => {
  const sessions = temporaryDirectory();
  const stateDir = temporaryDirectory();
  const sessionId = "bounded-stat-rollout";
  const statCountFile = path.join(temporaryDirectory(), "stat-count.txt");
  for (let index = 0; index < 64; index++) {
    fs.writeFileSync(
      path.join(sessions, `decoy-${String(index).padStart(3, "0")}.jsonl`),
      JSON.stringify({ type: "session_meta", payload: { id: `decoy-${index}` } }),
    );
  }
  fs.writeFileSync(statePath(stateDir, sessionId), JSON.stringify({
    schema: 2, sessionId, transcriptPath: null, cwd: "/tmp", source: "startup",
  }));
  const clock = preload([
    "const fs = require('node:fs');",
    "const originalStat = fs.statSync;",
    "const originalWrite = fs.writeFileSync;",
    "let now = 0;",
    "let jsonlStats = 0;",
    "Date.now = () => now;",
    "fs.statSync = function(file, ...args) {",
    "  if (typeof file === 'string' && file.endsWith('.jsonl')) { jsonlStats += 1; now += 10; }",
    "  return originalStat.call(this, file, ...args);",
    "};",
    "process.on('exit', () => originalWrite.call(fs, process.env.STAT_COUNT_FILE, String(jsonlStats)));",
  ].join("\n"));
  try {
    const stopped = stopSession("itixo-codex", {
      hook_event_name: "Stop", session_id: sessionId, cwd: "/tmp", model: "none", turn_id: "completed-turn",
    }, stateDir, {
      DIRIGENT_STATS_CODEX_SESSIONS_DIR: sessions,
      DIRIGENT_STATS_STOP_BUDGET_MS: "100",
      NODE_OPTIONS: clock.option,
      STAT_COUNT_FILE: statCountFile,
    });
    assert.equal(stopped.status, 0, stopped.stderr);
    assert.equal(stopped.stdout, "");
    assert.equal(stopped.stderr, "");
    const statCount = Number(fs.readFileSync(statCountFile, "utf8"));
    assert.ok(statCount <= 12, `candidate stat work must stop at deadline; observed ${statCount} JSONL stats`);
    const persisted = JSON.parse(fs.readFileSync(statePath(stateDir, sessionId), "utf8"));
    assert.equal(persisted.cache.report, "No token usage available yet.");
  } finally {
    fs.rmSync(clock.directory, { recursive: true, force: true });
  }
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
  assert.match(output, /\| orchestrator \| root-model \| 1 \| 0\.02 kToks \| 44\.4% \|/);
  assert.match(output, /\| builder \| worker-model-a, worker-model-b \| 2 \| 0\.02 kToks \| 44\.4% \|/);
  assert.match(output, /\| unknown \| worker-model-c \| 1 \| 0\.005 kToks \| 11\.1% \|/);
  assert.match(output, /\| root-model \| 1 \| 0\.02 kToks \| 44\.4% \|/);
  assert.match(output, /\| worker-model-a \| 1 \| 0\.01 kToks \| 22\.2% \|/);
  assert.match(output, /\| worker-model-b \| 1 \| 0\.01 kToks \| 22\.2% \|/);
  assert.match(output, /\| worker-model-c \| 1 \| 0\.005 kToks \| 11\.1% \|/);
  assert.match(output, /One or more child transcript identities were unavailable/);
  assert.match(output, /Some assistant usage records were unavailable/);
  assert.match(output, /Some assistant usage records lacked stable message IDs/);
  assert.doesNotMatch(output, /unrelated-model|999|100 \||77 \|/);
  assert.doesNotMatch(output, /\| root-model \| 2 \| 120 \|/);
});

test("stats hooks accept only their locked explicit invocation contracts", () => {
  const claudeFixture = path.join(root, "tests", "fixtures", "dirigent-stats", "claude");
  const claudeProjects = path.join(claudeFixture, "projects");
  const codexSessions = path.join(root, "tests", "fixtures", "dirigent-stats", "codex", "sessions");
  const cases = [
    {
      plugin: "itixo-claude", sessionId: "root-run", root: path.join(claudeProjects, "synthetic-project", "root-run.jsonl"),
      script: path.join(root, "plugins", "itixo-claude", "scripts", "dirigent-stats.js"),
      env: { DIRIGENT_STATS_CLAUDE_PROJECTS_DIR: claudeProjects, DIRIGENT_STATS_CLAUDE_LEDGER_DIR: path.join(claudeFixture, "ledger") },
      accepted: ["/dirigent-stats", "$dirigent-stats", "/itixo-claude:dirigent-stats", "$itixo-claude:dirigent-stats"],
      rejected: ["/itixo-codex:dirigent-stats", "$itixo-codex:dirigent-stats"],
    },
    {
      plugin: "itixo-codex", sessionId: "root-rollout", root: path.join(codexSessions, "root.jsonl"),
      script: path.join(root, "plugins", "itixo-codex", "scripts", "dirigent-stats.js"),
      env: { DIRIGENT_STATS_CODEX_SESSIONS_DIR: codexSessions },
      accepted: ["/dirigent-stats", "$dirigent-stats", "/itixo-codex:dirigent-stats", "$itixo-codex:dirigent-stats"],
      rejected: ["/itixo-claude:dirigent-stats", "$itixo-claude:dirigent-stats"],
    },
  ];
  for (const current of cases) {
    const namespace = current.plugin;
    const otherNamespace = current.plugin === "itixo-claude" ? "itixo-codex" : "itixo-claude";
    const punctuated = [".", ",", "!", "?", ";", ":"].flatMap((punctuation) => [
      `/dirigent-stats${punctuation}`,
      `$dirigent-stats${punctuation} trailing text`,
      `/${namespace}:dirigent-stats${punctuation}`,
      `$${namespace}:dirigent-stats${punctuation} trailing text`,
    ]);
    const accepted = [...current.accepted, "please /dirigent-stats now", ...punctuated];
    const rejected = [
      ...current.rejected,
      "/:dirigent-stats",
      "$:dirigent-stats",
      `/${namespace}:`,
      `$${namespace}:`,
      `/${namespace}:${namespace}:dirigent-stats`,
      `$${namespace}:${namespace}:dirigent-stats`,
      "/dirigent-stats-extra",
      "$dirigent-stats-extra",
      `/${namespace}:dirigent-stats:extra`,
      `$${namespace}:dirigent-stats:extra`,
      `/${otherNamespace}:dirigent-stats:extra`,
      `$${otherNamespace}:dirigent-stats:extra`,
      "/dirigent-stats.foo",
      "$dirigent-stats.foo",
      `/${namespace}:dirigent-stats.foo`,
      `$${namespace}:dirigent-stats.foo`,
      `/${otherNamespace}:dirigent-stats.foo`,
      `$${otherNamespace}:dirigent-stats.foo`,
      "x/dirigent-stats",
      "please/foo/dirigent-stats",
      "show stats",
    ];
    const stateDir = temporaryDirectory();
    startSession(current.plugin, { source: "startup", session_id: current.sessionId, transcript_path: current.root }, stateDir);
    const stopped = stopSession(current.plugin, {
      hook_event_name: "Stop", session_id: current.sessionId, transcript_path: current.root, cwd: "/tmp", model: "root-model", turn_id: "completed-turn",
    }, stateDir, current.env);
    assert.equal(stopped.status, 0, stopped.stderr);
    const before = JSON.parse(fs.readFileSync(statePath(stateDir, current.sessionId), "utf8"));
    const baseline = before.cache.report;
    assert.ok(baseline);

    for (const prompt of accepted) {
      assert.equal(context(run(current.script, { prompt, session_id: current.sessionId }, {
        ...current.env, DIRIGENT_STATS_STATE_DIR: stateDir,
      })), baseline, `${current.plugin} must accept ${prompt}`);
      assert.deepEqual(JSON.parse(fs.readFileSync(statePath(stateDir, current.sessionId), "utf8")), before);
    }
    for (const prompt of rejected) {
      const result = run(current.script, { prompt, session_id: current.sessionId }, {
        ...current.env, DIRIGENT_STATS_STATE_DIR: stateDir,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, "", `${current.plugin} must ignore ${prompt}`);
      assert.equal(result.stderr, "");
      assert.deepEqual(JSON.parse(fs.readFileSync(statePath(stateDir, current.sessionId), "utf8")), before);
    }
    const malformed = spawnSync(process.execPath, [current.script], { encoding: "utf8", input: "{" });
    assert.equal(malformed.status, 0, malformed.stderr);
    assert.equal(malformed.stdout, "");
    assert.equal(malformed.stderr, "");
  }
});

test("Claude Submit and Expansion hooks emit exactly once through their intended lifecycle", () => {
  const fixture = path.join(root, "tests", "fixtures", "dirigent-stats", "claude");
  const projects = path.join(fixture, "projects");
  const rootTranscript = path.join(projects, "synthetic-project", "root-run.jsonl");
  const script = path.join(root, "plugins", "itixo-claude", "scripts", "dirigent-stats.js");
  const stateDir = temporaryDirectory();
  const env = {
    DIRIGENT_STATS_CLAUDE_PROJECTS_DIR: projects,
    DIRIGENT_STATS_CLAUDE_LEDGER_DIR: path.join(fixture, "ledger"),
    DIRIGENT_STATS_STATE_DIR: stateDir,
  };
  startSession("itixo-claude", { source: "startup", session_id: "root-run", transcript_path: rootTranscript }, stateDir);
  stopSession("itixo-claude", {
    hook_event_name: "Stop", session_id: "root-run", transcript_path: rootTranscript, cwd: "/tmp", model: "root-model", turn_id: "completed-turn",
  }, stateDir, env);
  const before = JSON.parse(fs.readFileSync(statePath(stateDir, "root-run"), "utf8"));
  const assertNoOutput = (event) => {
    const result = run(script, event, env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(fs.readFileSync(statePath(stateDir, "root-run"), "utf8")), before);
  };
  const assertSingleReport = (event, hookEventName) => {
    const result = run(script, event, env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout);
    assert.equal(output.hookSpecificOutput.hookEventName, hookEventName);
    assert.equal(output.hookSpecificOutput.additionalContext, before.cache.report);
    assert.equal(result.stdout.trim().split("\n").length, 1);
    assert.doesNotMatch(result.stdout, /<!--|itixo-dirigent-stats-report/);
    assert.deepEqual(JSON.parse(fs.readFileSync(statePath(stateDir, "root-run"), "utf8")), before);
  };

  for (const prompt of ["/dirigent-stats", "/itixo-claude:dirigent-stats"]) {
    assertNoOutput({ hook_event_name: "UserPromptSubmit", prompt, session_id: "root-run" });
  }
  for (const command_name of ["dirigent-stats", "itixo-claude:dirigent-stats"]) {
    assertSingleReport({
      hook_event_name: "UserPromptExpansion", expansion_type: "slash_command", command_name, session_id: "root-run",
    }, "UserPromptExpansion");
  }
  assertSingleReport({
    hook_event_name: "UserPromptSubmit", prompt: "$itixo-claude:dirigent-stats", session_id: "root-run",
  }, "UserPromptSubmit");
  assertSingleReport({
    hook_event_name: "UserPromptSubmit", prompt: "please /dirigent-stats now", session_id: "root-run",
  }, "UserPromptSubmit");
  assertSingleReport({ prompt: "/dirigent-stats", session_id: "root-run" }, "UserPromptSubmit");

  for (const event of [
    { hook_event_name: "UserPromptExpansion", expansion_type: "plain_text", command_name: "dirigent-stats", session_id: "root-run" },
    { hook_event_name: "UserPromptExpansion", expansion_type: "slash_command", command_name: "itixo-codex:dirigent-stats", session_id: "root-run" },
    { hook_event_name: "UserPromptExpansion", expansion_type: "slash_command", command_name: "dirigent-stats-extra", session_id: "root-run" },
  ]) {
    assertNoOutput(event);
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
    assert.match(cached, /^## Dirigent Stats$/m);
    assert.doesNotMatch(cached, /<!--|Instruction:|Snapshot:/);
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
      assert.equal(afterRefresh, "No token usage available yet.");
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
  assert.match(prior, /Exact known total: 0\.065 kToks\./);

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
  assert.doesNotMatch(current, /Exact known total: 0\.065 kToks|root-model|worker-model/);
  assert.equal(current, "No token usage available yet.");
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
    assert.match(recovered, /\| orchestrator \| root-model \| 1 \| 0\.03 kToks \| 46\.2% \|/);
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
    assert.match(defaultReport, /Exact known total: 0\.007 kToks\./);
    assert.match(maximumReport, /Exact known total: 0\.007 kToks\./);
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
  assert.match(output, /\| orchestrator \| root-model \| 1 \| 0\.03 kToks \| 46\.2% \|/);
  assert.match(output, /\| builder \| worker-model-a, worker-model-b \| 2 \| 0\.035 kToks \| 53\.8% \|/);
  assert.match(output, /\| root-model \| 1 \| 0\.03 kToks \| 46\.2% \|/);
  assert.match(output, /\| worker-model-a \| 1 \| 0\.02 kToks \| 30\.8% \|/);
  assert.match(output, /\| worker-model-b \| 1 \| 0\.015 kToks \| 23\.1% \|/);
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
  assert.match(output, /\| orchestrator \| incremental-model \| 1 \| 0\.03 kToks \| 100\.0% \|/);
  assert.match(output, /\| incremental-model \| 1 \| 0\.03 kToks \| 100\.0% \|/);
  assert.match(output, /Exact known total: 0\.03 kToks\./);
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
  assert.match(output, /\| post-reset-model \| 1 \| 0\.012 kToks \| 100\.0% \|/);
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

test("both providers select pre-rendered cached views without rescanning transcripts", () => {
  const claudeFixture = path.join(root, "tests", "fixtures", "dirigent-stats", "claude");
  const codexFixture = path.join(root, "tests", "fixtures", "dirigent-stats", "codex", "sessions");
  const cases = [
    {
      plugin: "itixo-claude",
      sessionId: "root-run",
      fixture: claudeFixture,
      storage: (copy) => path.join(copy, "projects"),
      transcript: (copy) => path.join(copy, "projects", "synthetic-project", "root-run.jsonl"),
      env: (copy) => ({
        DIRIGENT_STATS_CLAUDE_PROJECTS_DIR: path.join(copy, "projects"),
        DIRIGENT_STATS_CLAUDE_LEDGER_DIR: path.join(copy, "ledger"),
      }),
      requests: [
        ["agents", { hook_event_name: "UserPromptExpansion", expansion_type: "slash_command", command_name: "dirigent-stats", command_args: "--view agents", session_id: "root-run" }],
        ["models", { hook_event_name: "UserPromptExpansion", expansion_type: "slash_command", command_name: "itixo-claude:dirigent-stats", command_args: "--view models", session_id: "root-run" }],
        ["both", { prompt: "$itixo-claude:dirigent-stats --view both", session_id: "root-run" }],
        ["both", { prompt: "$dirigent-stats", session_id: "root-run" }],
      ],
      invalid: (args) => ({
        hook_event_name: "UserPromptExpansion", expansion_type: "slash_command",
        command_name: "dirigent-stats", command_args: args, session_id: "root-run",
      }),
    },
    {
      plugin: "itixo-codex",
      sessionId: "root-rollout",
      fixture: codexFixture,
      storage: (copy) => copy,
      transcript: (copy) => path.join(copy, "root.jsonl"),
      env: (copy) => ({ DIRIGENT_STATS_CODEX_SESSIONS_DIR: copy }),
      requests: [
        ["agents", { prompt: "/dirigent-stats --view agents", session_id: "root-rollout" }],
        ["models", { prompt: "$itixo-codex:dirigent-stats --view models", session_id: "root-rollout" }],
        ["both", { prompt: "/itixo-codex:dirigent-stats --view both", session_id: "root-rollout" }],
        ["both", { prompt: "$dirigent-stats", session_id: "root-rollout" }],
      ],
      invalid: (args) => ({ prompt: `$dirigent-stats ${args}`, session_id: "root-rollout" }),
    },
  ];
  const sentinel = preload([
    "const fs = require('node:fs');",
    "const original = fs.readFileSync;",
    "fs.readFileSync = function(file, ...args) {",
    "  if (typeof file === 'string' && file.endsWith('.jsonl')) throw new Error('unexpected transcript rescan');",
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
      startSession(current.plugin, {
        source: "startup", session_id: current.sessionId, transcript_path: transcript,
      }, stateDir);
      const stopped = stopSession(current.plugin, {
        hook_event_name: "Stop", session_id: current.sessionId, transcript_path: transcript,
        cwd: "/tmp", model: "root-model", turn_id: "view-turn",
      }, stateDir, env);
      assert.equal(stopped.status, 0, stopped.stderr);
      fs.rmSync(current.storage(copy), { recursive: true, force: true });
      const script = path.join(root, "plugins", current.plugin, "scripts", "dirigent-stats.js");
      for (const [view, event] of current.requests) {
        assertView(context(run(script, event, {
          ...env, DIRIGENT_STATS_STATE_DIR: stateDir, NODE_OPTIONS: sentinel.option,
        })), view);
      }
      for (const args of ["--view", "--view unknown", "--view agents --view models"]) {
        assert.equal(context(run(script, current.invalid(args), {
          ...env, DIRIGENT_STATS_STATE_DIR: stateDir, NODE_OPTIONS: sentinel.option,
        })), INVALID_VIEW);
      }
    }
  } finally {
    fs.rmSync(sentinel.directory, { recursive: true, force: true });
  }
});

test("both providers use the exact zero sentinel and lossless grouped kToks formatting", () => {
  for (const plugin of plugins) {
    const script = path.join(root, "plugins", plugin, "scripts", "dirigent-stats.js");
    const emptyState = temporaryDirectory();
    const emptyStorage = temporaryDirectory();
    const emptySession = `${plugin}-empty`;
    startSession(plugin, { source: "startup", session_id: emptySession }, emptyState);
    const emptyEnv = plugin === "itixo-claude"
      ? { DIRIGENT_STATS_CLAUDE_PROJECTS_DIR: emptyStorage, DIRIGENT_STATS_CLAUDE_LEDGER_DIR: emptyStorage }
      : { DIRIGENT_STATS_CODEX_SESSIONS_DIR: emptyStorage };
    assert.equal(context(run(script, { prompt: "$dirigent-stats", session_id: emptySession }, {
      ...emptyEnv, DIRIGENT_STATS_STATE_DIR: emptyState,
    })), "No token usage available yet.");

    const storage = temporaryDirectory();
    const stateDir = temporaryDirectory();
    const sessionId = `${plugin}-format`;
    let transcript;
    let env;
    if (plugin === "itixo-claude") {
      const projects = path.join(storage, "projects");
      const ledger = path.join(storage, "ledger");
      transcript = path.join(projects, "project", `${sessionId}.jsonl`);
      writeJsonl(transcript, [
        { type: "assistant", sessionId, message: { id: "root-message", model: "model-25000000", usage: { input_tokens: 25_000_000 } } },
      ]);
      for (const value of [1, 20, 999, 1000, 1250]) {
        writeJsonl(path.join(projects, "project", sessionId, "subagents", `agent-${value}.jsonl`), [
          { type: "assistant", sessionId: `child-${value}`, agentId: `agent-${value}`, message: { id: `message-${value}`, model: `model-${value}`, usage: { input_tokens: value } } },
        ]);
      }
      env = { DIRIGENT_STATS_CLAUDE_PROJECTS_DIR: projects, DIRIGENT_STATS_CLAUDE_LEDGER_DIR: ledger };
    } else {
      const sessions = path.join(storage, "sessions");
      transcript = path.join(sessions, "root.jsonl");
      writeJsonl(transcript, [
        { type: "session_meta", payload: { id: sessionId } },
        { type: "turn_context", payload: { turn_id: "root-turn", model: "model-25000000" } },
        { type: "event_msg", payload: { info: { total_token_usage: { total_tokens: 25_000_000 }, last_token_usage: { total_tokens: 25_000_000 } } } },
      ]);
      for (const value of [1, 20, 999, 1000, 1250]) {
        writeJsonl(path.join(sessions, `child-${value}.jsonl`), [
          { type: "session_meta", payload: { id: `child-${value}`, parent_thread_id: sessionId, agent_role: `role-${value}` } },
          { type: "turn_context", payload: { turn_id: `turn-${value}`, model: `model-${value}` } },
          { type: "event_msg", payload: { info: { total_token_usage: { total_tokens: value }, last_token_usage: { total_tokens: value } } } },
        ]);
      }
      env = { DIRIGENT_STATS_CODEX_SESSIONS_DIR: sessions };
    }
    startSession(plugin, { source: "startup", session_id: sessionId, transcript_path: transcript }, stateDir);
    const stopped = stopSession(plugin, {
      hook_event_name: "Stop", session_id: sessionId, transcript_path: transcript,
      cwd: "/tmp", turn_id: "format-turn",
    }, stateDir, env);
    assert.equal(stopped.status, 0, stopped.stderr);
    const report = context(run(script, { prompt: "$dirigent-stats", session_id: sessionId }, {
      ...env, DIRIGENT_STATS_STATE_DIR: stateDir,
    }));
    assertView(report, "both");
    for (const formatted of ["0.001", "0.02", "0.999", "1", "1.25", "25,000"]) {
      assert.match(report, new RegExp(`\\| ${formatted.replace(".", "\\.")} kToks \\|`));
    }
    assert.match(report, /Exact known total: 25,003\.27 kToks\./);
    assert.doesNotMatch(report, /mToks|\bTokens\b|Exact known total: .* tokens\./);
    assertUsageInvariant(report);
  }
});

test("Claude globally deduplicates copied transcripts and keeps only final streamed message usage", () => {
  const storage = temporaryDirectory();
  const projects = path.join(storage, "projects");
  const ledger = path.join(storage, "ledger");
  const stateDir = temporaryDirectory();
  const sessionId = "claude-dedup";
  const transcript = path.join(projects, "project", `${sessionId}.jsonl`);
  writeJsonl(transcript, [
    { type: "assistant", sessionId, message: { id: "root-message", model: "root-model", usage: { input_tokens: 1000 } } },
  ]);
  const streamed = [
    { type: "assistant", sessionId: "copied-child", agentId: "copied-agent", message: { id: "streamed-message", model: "child-model", usage: { input_tokens: 20 } } },
    { type: "assistant", sessionId: "copied-child", agentId: "copied-agent", message: { id: "streamed-message", model: "child-model", usage: { input_tokens: 1000 } } },
  ];
  writeJsonl(path.join(projects, "project", sessionId, "subagents", "agent-copy-a.jsonl"), streamed);
  writeJsonl(path.join(projects, "project", sessionId, "subagents", "agent-copy-b.jsonl"), streamed);
  writeJsonl(path.join(ledger, `itixo-delegation-${sessionId}.jsonl`), [
    { agentId: "copied-agent", agentType: "builder" },
  ]);
  startSession("itixo-claude", { source: "startup", session_id: sessionId, transcript_path: transcript }, stateDir);
  assert.equal(stopSession("itixo-claude", {
    hook_event_name: "Stop", session_id: sessionId, transcript_path: transcript, turn_id: "dedup-turn",
  }, stateDir, {
    DIRIGENT_STATS_CLAUDE_PROJECTS_DIR: projects, DIRIGENT_STATS_CLAUDE_LEDGER_DIR: ledger,
  }).status, 0);
  const report = context(run(path.join(root, "plugins", "itixo-claude", "scripts", "dirigent-stats.js"), {
    prompt: "$dirigent-stats", session_id: sessionId,
  }, {
    DIRIGENT_STATS_CLAUDE_PROJECTS_DIR: projects, DIRIGENT_STATS_CLAUDE_LEDGER_DIR: ledger,
    DIRIGENT_STATS_STATE_DIR: stateDir,
  }));
  assert.match(report, /\| builder \| child-model \| 1 \| 1 kToks \| 50\.0% \|/);
  assert.match(report, /Exact known total: 2 kToks\./);
  assertUsageInvariant(report);
});

test("Codex deduplicates conflicting rollout IDs and counts repeated cumulative snapshots once", () => {
  const sessions = temporaryDirectory();
  const stateDir = temporaryDirectory();
  const sessionId = "codex-dedup";
  const transcript = path.join(sessions, "root.jsonl");
  writeJsonl(transcript, [
    { type: "session_meta", payload: { id: sessionId } },
    { type: "turn_context", payload: { turn_id: "root-turn", model: "root-model" } },
    { type: "event_msg", payload: { info: { total_token_usage: { total_tokens: 200 }, last_token_usage: { total_tokens: 200 } } } },
    { type: "response_item", payload: { info: { total_token_usage: { total_tokens: 1000 }, last_token_usage: { total_tokens: 800 } } } },
    { type: "event_msg", payload: { info: { total_token_usage: { total_tokens: 1000 }, last_token_usage: { total_tokens: 800 } } } },
  ]);
  for (const [file, model] of [["child-a.jsonl", "child-model-a"], ["child-b.jsonl", "child-model-b"]]) {
    writeJsonl(path.join(sessions, file), [
      { type: "session_meta", payload: { id: "duplicate-child", parent_thread_id: sessionId, agent_role: "builder" } },
      { type: "turn_context", payload: { turn_id: "child-turn", model } },
      { type: "event_msg", payload: { info: { total_token_usage: { total_tokens: 1000 }, last_token_usage: { total_tokens: 1000 } } } },
    ]);
  }
  startSession("itixo-codex", { source: "startup", session_id: sessionId, transcript_path: transcript }, stateDir);
  assert.equal(stopSession("itixo-codex", {
    hook_event_name: "Stop", session_id: sessionId, transcript_path: transcript, turn_id: "dedup-turn",
  }, stateDir, { DIRIGENT_STATS_CODEX_SESSIONS_DIR: sessions }).status, 0);
  const report = context(run(path.join(root, "plugins", "itixo-codex", "scripts", "dirigent-stats.js"), {
    prompt: "$dirigent-stats", session_id: sessionId,
  }, { DIRIGENT_STATS_CODEX_SESSIONS_DIR: sessions, DIRIGENT_STATS_STATE_DIR: stateDir }));
  assert.match(report, /\| orchestrator \| root-model \| 1 \| 1 kToks \| 50\.0% \|/);
  assert.match(report, /\| builder \| child-model-[ab] \| 1 \| 1 kToks \| 50\.0% \|/);
  assert.match(report, /Exact known total: 2 kToks\./);
  assert.match(report, /Warning(?:s)?:[\s\S]*duplicate[\s\S]*rollout[\s\S]*conflict/i);
  assertUsageInvariant(report);
});

test("Claude scopes message IDs by each validated child transcript session", () => {
  const storage = temporaryDirectory();
  const projects = path.join(storage, "projects");
  const ledger = path.join(storage, "ledger");
  const stateDir = temporaryDirectory();
  const sessionId = "claude-session-scoped-message";
  const transcript = path.join(projects, "project", `${sessionId}.jsonl`);
  writeJsonl(transcript, [
    { type: "user", sessionId, message: { content: "root" } },
    { type: "assistant", sessionId, message: { id: "root-message", model: "root-model", usage: { input_tokens: 1000 } } },
  ]);
  const childRecords = (childSession, agent, model, tokens) => [
    { type: "user", sessionId: childSession, agentId: agent, message: { content: "child" } },
    // Claude streaming usage records may omit the session ID. The file's
    // validated session identity must scope this otherwise shared message ID.
    { type: "assistant", agentId: agent, message: { id: "shared-message", model, usage: { input_tokens: tokens } } },
  ];
  writeJsonl(
    path.join(projects, "project", sessionId, "subagents", "agent-child-a.jsonl"),
    childRecords("child-session-a", "agent-a", "child-model-a", 1000),
  );
  writeJsonl(
    path.join(projects, "project", sessionId, "subagents", "agent-child-a-copy.jsonl"),
    childRecords("child-session-a", "agent-a", "child-model-a", 1000),
  );
  writeJsonl(
    path.join(projects, "project", sessionId, "subagents", "agent-child-b.jsonl"),
    childRecords("child-session-b", "agent-b", "child-model-b", 2000),
  );
  writeJsonl(path.join(ledger, `itixo-delegation-${sessionId}.jsonl`), [
    { agentId: "agent-a", agentType: "builder" },
    { agentId: "agent-b", agentType: "builder" },
  ]);
  startSession("itixo-claude", { source: "startup", session_id: sessionId, transcript_path: transcript }, stateDir);
  const stopped = stopSession("itixo-claude", {
    hook_event_name: "Stop", session_id: sessionId, transcript_path: transcript, turn_id: "session-scope-turn",
  }, stateDir, {
    DIRIGENT_STATS_CLAUDE_PROJECTS_DIR: projects,
    DIRIGENT_STATS_CLAUDE_LEDGER_DIR: ledger,
  });
  assert.equal(stopped.status, 0, stopped.stderr);
  const report = context(run(path.join(root, "plugins", "itixo-claude", "scripts", "dirigent-stats.js"), {
    prompt: "$dirigent-stats", session_id: sessionId,
  }, {
    DIRIGENT_STATS_CLAUDE_PROJECTS_DIR: projects,
    DIRIGENT_STATS_CLAUDE_LEDGER_DIR: ledger,
    DIRIGENT_STATS_STATE_DIR: stateDir,
  }));
  assert.match(report, /\| builder \| child-model-a, child-model-b \| 2 \| 3 kToks \| 75\.0% \|/);
  assert.match(report, /\| child-model-a \| 1 \| 1 kToks \| 25\.0% \|/);
  assert.match(report, /\| child-model-b \| 1 \| 2 kToks \| 50\.0% \|/);
  assert.match(report, /Exact known total: 4 kToks\./);
  assertUsageInvariant(report);
});

function inconsistentCachedReports() {
  return {
    both: [
      "## Dirigent Stats", "",
      AGENT_USAGE_HEADER, "| --- | --- | ---: | ---: | ---: |",
      "| both-agent | both-model | 1 | 1 kToks | 100.0% |", "",
      MODEL_USAGE_HEADER, "| --- | ---: | ---: | ---: |",
      "| both-model | 1 | 1 kToks | 100.0% |", "",
      "Exact known total: 1 kToks.",
      "Warnings:", "- both-only warning",
    ].join("\n"),
    agents: [
      "## Dirigent Stats", "",
      AGENT_USAGE_HEADER, "| --- | --- | ---: | ---: | ---: |",
      "| agents-only | agents-model | 1 | 2 kToks | 100.0% |", "",
      "Exact known total: 2 kToks.",
      "Warnings:", "- agents-only warning",
    ].join("\n"),
    models: [
      "## Dirigent Stats", "",
      MODEL_USAGE_HEADER, "| --- | ---: | ---: | ---: |",
      "| models-only | 1 | 3 kToks | 100.0% |", "",
      "Exact known total: 3 kToks.",
      "Warnings:", "- models-only warning",
    ].join("\n"),
  };
}

function schemaTwoState(sessionId, transcriptPath, reports) {
  return {
    schema: 2,
    sessionId,
    transcriptPath,
    cwd: "/tmp",
    source: "startup",
    cache: {
      schema: 2,
      sessionId,
      transcriptPath,
      reports,
      report: reports.both,
      createdAt: "2026-07-23T00:00:00.000Z",
      updatedAt: 1_753_228_800_000,
      turnId: "inconsistent-turn",
    },
  };
}

for (const plugin of plugins) {
  test(`${plugin} rejects individually valid but mutually inconsistent cache variants`, () => {
    const isClaude = plugin === "itixo-claude";
    const fixture = isClaude
      ? path.join(root, "tests", "fixtures", "dirigent-stats", "claude")
      : path.join(root, "tests", "fixtures", "dirigent-stats", "codex", "sessions");
    const storageRoot = temporaryDirectory();
    const storage = path.join(storageRoot, "source");
    fs.cpSync(fixture, storage, { recursive: true });
    const sessionId = isClaude ? "root-run" : "root-rollout";
    const transcript = isClaude
      ? path.join(storage, "projects", "synthetic-project", "root-run.jsonl")
      : path.join(storage, "root.jsonl");
    const env = isClaude
      ? {
        DIRIGENT_STATS_CLAUDE_PROJECTS_DIR: path.join(storage, "projects"),
        DIRIGENT_STATS_CLAUDE_LEDGER_DIR: path.join(storage, "ledger"),
      }
      : { DIRIGENT_STATS_CODEX_SESSIONS_DIR: storage };
    const script = path.join(root, "plugins", plugin, "scripts", "dirigent-stats.js");

    const expectedStateDir = temporaryDirectory();
    startSession(plugin, { source: "startup", session_id: sessionId, transcript_path: transcript }, expectedStateDir);
    const stopped = stopSession(plugin, {
      hook_event_name: "Stop", session_id: sessionId, transcript_path: transcript,
      cwd: "/tmp", turn_id: "expected-turn",
    }, expectedStateDir, env);
    assert.equal(stopped.status, 0, stopped.stderr);
    const expected = JSON.parse(fs.readFileSync(statePath(expectedStateDir, sessionId), "utf8")).cache.reports;

    for (const view of ["both", "agents", "models"]) {
      const stateDir = temporaryDirectory();
      fs.writeFileSync(
        statePath(stateDir, sessionId),
        JSON.stringify(schemaTwoState(sessionId, transcript, inconsistentCachedReports())),
      );
      const output = context(run(script, {
        prompt: `$dirigent-stats --view ${view}`, session_id: sessionId,
      }, {
        ...env,
        DIRIGENT_STATS_STATE_DIR: stateDir,
        ...(isClaude ? { DIRIGENT_STATS_TIMEOUT_MS: "100" } : { DIRIGENT_STATS_STOP_BUDGET_MS: "100" }),
      }));
      assert.equal(output, expected[view], `${plugin} served inconsistent ${view} cache`);
      const healed = JSON.parse(fs.readFileSync(statePath(stateDir, sessionId), "utf8")).cache.reports;
      assert.deepEqual(healed, expected);
    }

    const unavailableTranscript = path.join(storageRoot, "missing.jsonl");
    const unavailableEnv = isClaude
      ? {
        DIRIGENT_STATS_CLAUDE_PROJECTS_DIR: path.join(storageRoot, "missing-projects"),
        DIRIGENT_STATS_CLAUDE_LEDGER_DIR: path.join(storageRoot, "missing-ledger"),
      }
      : { DIRIGENT_STATS_CODEX_SESSIONS_DIR: path.join(storageRoot, "missing-sessions") };
    for (const view of ["both", "agents", "models"]) {
      const stateDir = temporaryDirectory();
      fs.writeFileSync(
        statePath(stateDir, sessionId),
        JSON.stringify(schemaTwoState(sessionId, unavailableTranscript, inconsistentCachedReports())),
      );
      const output = context(run(script, {
        prompt: `$dirigent-stats --view ${view}`, session_id: sessionId,
      }, { ...unavailableEnv, DIRIGENT_STATS_STATE_DIR: stateDir }));
      assert.equal(output, "No token usage available yet.");
      assert.deepEqual(
        JSON.parse(fs.readFileSync(statePath(stateDir, sessionId), "utf8")).cache.reports,
        { both: "No token usage available yet.", agents: "No token usage available yet.", models: "No token usage available yet." },
      );
    }
  });
}

test("Claude copied transcripts choose final cumulative message usage independent of filename order", () => {
  const reportFor = (highName, staleName) => {
    const storage = temporaryDirectory();
    const projects = path.join(storage, "projects");
    const ledger = path.join(storage, "ledger");
    const stateDir = temporaryDirectory();
    const sessionId = `claude-copy-order-${highName.replace(/\W/g, "-")}`;
    const transcript = path.join(projects, "project", `${sessionId}.jsonl`);
    writeJsonl(transcript, [
      { type: "assistant", sessionId, message: { id: "root-message", model: "root-model", usage: { input_tokens: 1000 } } },
    ]);
    const childDir = path.join(projects, "project", sessionId, "subagents");
    writeJsonl(path.join(childDir, highName), [
      { type: "user", sessionId: "copied-child", agentId: "copied-agent", message: { content: "child" } },
      { type: "assistant", agentId: "copied-agent", message: { id: "copied-message", model: "child-model", usage: { input_tokens: 2000 } } },
      { type: "assistant", agentId: "copied-agent", message: { id: "copied-message", model: "child-model", usage: { input_tokens: 3000 } } },
    ]);
    writeJsonl(path.join(childDir, staleName), [
      { type: "user", sessionId: "copied-child", agentId: "copied-agent", message: { content: "child" } },
      { type: "assistant", agentId: "copied-agent", message: { id: "copied-message", model: "child-model", usage: { input_tokens: 1000 } } },
    ]);
    writeJsonl(path.join(ledger, `itixo-delegation-${sessionId}.jsonl`), [
      { agentId: "copied-agent", agentType: "builder" },
    ]);
    startSession("itixo-claude", { source: "startup", session_id: sessionId, transcript_path: transcript }, stateDir);
    const stopped = stopSession("itixo-claude", {
      hook_event_name: "Stop", session_id: sessionId, transcript_path: transcript, turn_id: "copy-order-turn",
    }, stateDir, {
      DIRIGENT_STATS_CLAUDE_PROJECTS_DIR: projects,
      DIRIGENT_STATS_CLAUDE_LEDGER_DIR: ledger,
    });
    assert.equal(stopped.status, 0, stopped.stderr);
    return context(run(path.join(root, "plugins", "itixo-claude", "scripts", "dirigent-stats.js"), {
      prompt: "$dirigent-stats", session_id: sessionId,
    }, {
      DIRIGENT_STATS_CLAUDE_PROJECTS_DIR: projects,
      DIRIGENT_STATS_CLAUDE_LEDGER_DIR: ledger,
      DIRIGENT_STATS_STATE_DIR: stateDir,
    }));
  };

  const reports = [
    reportFor("a-final.jsonl", "z-stale.jsonl"),
    reportFor("z-final.jsonl", "a-stale.jsonl"),
  ];
  for (const report of reports) {
    assert.match(report, /\| builder \| child-model \| 1 \| 3 kToks \| 75\.0% \|/);
    assert.match(report, /\| child-model \| 1 \| 3 kToks \| 75\.0% \|/);
    assert.match(report, /Exact known total: 4 kToks\./);
    assertUsageInvariant(report);
  }
});

function arithmeticMismatchReports() {
  const agentTable = [
    AGENT_USAGE_HEADER,
    "| --- | --- | ---: | ---: | ---: |",
    "| orchestrator | grouped-model | 1 | 1,234.5 kToks | 100.0% |",
    "| builder | decimal-model | 1 | 0.25 kToks | 0.0% |",
  ];
  const modelTable = [
    MODEL_USAGE_HEADER,
    "| --- | ---: | ---: | ---: |",
    "| grouped-model | 1 | 1,234.5 kToks | 100.0% |",
    "| decimal-model | 1 | 0.125 kToks | 0.0% |",
  ];
  const suffix = [
    "Exact known total: 1,235 kToks.",
    "Warnings:",
    "- arithmetic cache warning",
  ];
  return {
    both: ["## Dirigent Stats", "", ...agentTable, "", ...modelTable, "", ...suffix].join("\n"),
    agents: ["## Dirigent Stats", "", ...agentTable, "", ...suffix].join("\n"),
    models: ["## Dirigent Stats", "", ...modelTable, "", ...suffix].join("\n"),
  };
}

for (const plugin of plugins) {
  test(`${plugin} rejects cross-matching cache variants whose table arithmetic disagrees with total`, () => {
    const isClaude = plugin === "itixo-claude";
    const fixture = isClaude
      ? path.join(root, "tests", "fixtures", "dirigent-stats", "claude")
      : path.join(root, "tests", "fixtures", "dirigent-stats", "codex", "sessions");
    const storage = path.join(temporaryDirectory(), "source");
    fs.cpSync(fixture, storage, { recursive: true });
    const sessionId = isClaude ? "root-run" : "root-rollout";
    const transcript = isClaude
      ? path.join(storage, "projects", "synthetic-project", "root-run.jsonl")
      : path.join(storage, "root.jsonl");
    const env = isClaude
      ? {
        DIRIGENT_STATS_CLAUDE_PROJECTS_DIR: path.join(storage, "projects"),
        DIRIGENT_STATS_CLAUDE_LEDGER_DIR: path.join(storage, "ledger"),
      }
      : { DIRIGENT_STATS_CODEX_SESSIONS_DIR: storage };
    const script = path.join(root, "plugins", plugin, "scripts", "dirigent-stats.js");
    const expectedStateDir = temporaryDirectory();
    startSession(plugin, { source: "startup", session_id: sessionId, transcript_path: transcript }, expectedStateDir);
    const stopped = stopSession(plugin, {
      hook_event_name: "Stop", session_id: sessionId, transcript_path: transcript,
      cwd: "/tmp", turn_id: "expected-arithmetic-turn",
    }, expectedStateDir, env);
    assert.equal(stopped.status, 0, stopped.stderr);
    const expected = JSON.parse(fs.readFileSync(statePath(expectedStateDir, sessionId), "utf8")).cache.reports;

    const stateDir = temporaryDirectory();
    fs.writeFileSync(
      statePath(stateDir, sessionId),
      JSON.stringify(schemaTwoState(sessionId, transcript, arithmeticMismatchReports())),
    );
    const output = context(run(script, {
      prompt: "$dirigent-stats --view both", session_id: sessionId,
    }, { ...env, DIRIGENT_STATS_STATE_DIR: stateDir }));
    assert.equal(output, expected.both, `${plugin} served arithmetically inconsistent cache`);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(statePath(stateDir, sessionId), "utf8")).cache.reports,
      expected,
    );
  });
}
