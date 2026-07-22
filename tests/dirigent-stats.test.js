const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const plugins = ["itixo-claude", "itixo-codex"];
const skillRel = "skills/dirigent-stats/SKILL.md";
const metadataRel = "skills/dirigent-stats/agents/openai.yaml";

function read(plugin, rel) {
  return fs.readFileSync(path.join(root, "plugins", plugin, rel), "utf8");
}

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
});

test("Claude report aggregates recursive descendants without leaking unrelated data", () => {
  const fixture = path.join(root, "tests", "fixtures", "dirigent-stats", "claude");
  const projects = path.join(fixture, "projects");
  const ledger = path.join(fixture, "ledger");
  const transcript = path.join(projects, "synthetic-project", "root-run.jsonl");
  const script = path.join(root, "plugins", "itixo-claude", "scripts", "dirigent-stats.js");
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    input: JSON.stringify({ prompt: "$dirigent-stats", session_id: "root-run", transcript_path: transcript }),
    env: {
      ...process.env,
      DIRIGENT_STATS_CLAUDE_PROJECTS_DIR: projects,
      DIRIGENT_STATS_CLAUDE_LEDGER_DIR: ledger,
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
  assert.doesNotMatch(output, /unrelated-model|999|100 \|/);
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

test("Codex report follows recursive parent_thread_id and final usage snapshots", () => {
  const sessions = path.join(root, "tests", "fixtures", "dirigent-stats", "codex", "sessions");
  const script = path.join(root, "plugins", "itixo-codex", "scripts", "dirigent-stats.js");
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    input: JSON.stringify({ prompt: "/dirigent-stats", transcript_path: path.join(sessions, "root.jsonl") }),
    env: { ...process.env, DIRIGENT_STATS_CODEX_SESSIONS_DIR: sessions },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  assert.match(output, /\| orchestrator \| root-model, unknown \| 1 \| 30 \| 46\.2% \|/);
  assert.match(output, /\| builder \| unknown, worker-model-a, worker-model-b \| 2 \| 35 \| 53\.8% \|/);
  assert.match(output, /\| root-model \| 1 \| 25 \| 38\.5% \|/);
  assert.match(output, /\| worker-model-a \| 1 \| 20 \| 30\.8% \|/);
  assert.match(output, /\| worker-model-b \| 1 \| 10 \| 15\.4% \|/);
  assert.match(output, /\| unknown \| 2 \| 10 \| 15\.4% \|/);
  assert.match(output, /Partial report: usage unavailable/);
  assert.doesNotMatch(output, /unrelated-model|999/);
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
