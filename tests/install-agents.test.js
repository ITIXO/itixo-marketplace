"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const SOURCE_PLUGIN = path.join(ROOT, "plugins", "itixo-codex");
const AGENT_IDS = [
  "itixo-builder",
  "itixo-docs-updater",
  "itixo-github-issues",
  "itixo-investigator",
  "itixo-planner",
  "itixo-reviewer",
  "itixo-tester",
];
const MARKER = "# Itixo-managed custom agent. Do not edit.\n";

function withTemporaryDirectory(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "itixo-install-agents-"));
  try {
    return callback(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function makePlugin(directory) {
  const plugin = path.join(directory, "plugin");
  fs.mkdirSync(path.join(plugin, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(plugin, "templates", "agents"), { recursive: true });
  fs.copyFileSync(path.join(SOURCE_PLUGIN, "scripts", "install-agents.js"), path.join(plugin, "scripts", "install-agents.js"));
  for (const agentId of AGENT_IDS) {
    fs.copyFileSync(
      path.join(SOURCE_PLUGIN, "templates", "agents", `${agentId}.toml`),
      path.join(plugin, "templates", "agents", `${agentId}.toml`),
    );
  }
  return plugin;
}

function run(plugin, args, environment = {}) {
  return spawnSync(process.execPath, [path.join(plugin, "scripts", "install-agents.js"), ...args], {
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
}

function destination(root) {
  return path.join(root, ".codex", "agents");
}

function installedFiles(root) {
  const directory = destination(root);
  return fs.existsSync(directory) ? fs.readdirSync(directory).sort() : [];
}

function assertAgentSet(root) {
  assert.deepEqual(installedFiles(root), AGENT_IDS.map((agentId) => `${agentId}.toml`));
}

function readAgent(root, agentId) {
  return fs.readFileSync(path.join(destination(root), `${agentId}.toml`), "utf8");
}

test("installs exactly seven default Luna custom agents into an isolated personal home", () => {
  withTemporaryDirectory((temporary) => {
    const plugin = makePlugin(temporary);
    const home = path.join(temporary, "home");
    fs.mkdirSync(home);

    const result = run(plugin, ["--scope", "personal"], { HOME: home });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /^installed .+\n/m);
    assert.match(result.stdout, /summary installed=7 skipped=0 scope=personal cheap-model=luna\n$/);
    assertAgentSet(home);
    for (const agentId of ["itixo-investigator", "itixo-docs-updater"]) {
      assert.match(readAgent(home, agentId), /^model = "gpt-5\.6-luna"$/m);
      assert.match(readAgent(home, agentId), /^model_reasoning_effort = "low"$/m);
    }
    for (const agentId of ["itixo-builder", "itixo-github-issues", "itixo-tester", "itixo-reviewer"]) {
      assert.match(readAgent(home, agentId), /^model = "gpt-5\.6-terra"$/m);
      assert.match(readAgent(home, agentId), /^model_reasoning_effort = "medium"$/m);
    }
    assert.doesNotMatch(readAgent(home, "itixo-planner"), /^model(?:_reasoning_effort)? =/m);
  });
});

test("installs Terra low fallback only for cheap project agents", () => {
  withTemporaryDirectory((temporary) => {
    const plugin = makePlugin(temporary);
    const project = path.join(temporary, "project");
    fs.mkdirSync(project);

    const result = run(plugin, ["--scope", "project", "--project-root", project, "--cheap-model", "terra"]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /summary installed=7 skipped=0 scope=project cheap-model=terra\n$/);
    assertAgentSet(project);
    for (const agentId of ["itixo-investigator", "itixo-docs-updater"]) {
      assert.match(readAgent(project, agentId), /^model = "gpt-5\.6-terra"$/m);
      assert.match(readAgent(project, agentId), /^model_reasoning_effort = "low"$/m);
    }
    for (const agentId of ["itixo-builder", "itixo-github-issues", "itixo-tester", "itixo-reviewer"]) {
      assert.match(readAgent(project, agentId), /^model_reasoning_effort = "medium"$/m);
    }
    assert.doesNotMatch(readAgent(project, "itixo-planner"), /^model(?:_reasoning_effort)? =/m);
  });
});

test("rejects invalid arguments with deterministic nonzero errors", () => {
  withTemporaryDirectory((temporary) => {
    const plugin = makePlugin(temporary);
    const project = path.join(temporary, "project");
    fs.mkdirSync(project);
    const cases = [
      { args: [], error: "Argument '--scope' is required." },
      { args: ["--wat"], error: "Unknown argument '--wat'." },
      { args: ["--scope", "other"], error: "Invalid scope 'other'." },
      { args: ["--scope", "project"], error: "Argument '--project-root' is required when scope is 'project'." },
      { args: ["--scope", "personal", "--project-root", project], error: "Argument '--project-root' is valid only when scope is 'project'." },
      { args: ["--scope", "project", "--project-root", project, "--cheap-model", "luna"], error: "Invalid cheap model." },
      { args: ["--scope", "personal", "--scope", "personal"], error: "Argument '--scope' may be specified only once." },
      { args: ["--scope"], error: "Argument '--scope' requires a value." },
    ];
    for (const { args, error } of cases) {
      const result = run(plugin, args);
      assert.equal(result.status, 1, args.join(" "));
      assert.equal(result.stdout, "", args.join(" "));
      assert.match(result.stderr, new RegExp(`^Error: ${error.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    }
  });
});

test("rejects absent, non-directory, and symbolic-link project roots", () => {
  withTemporaryDirectory((temporary) => {
    const plugin = makePlugin(temporary);
    const missing = path.join(temporary, "missing");
    const file = path.join(temporary, "file");
    const real = path.join(temporary, "real");
    const link = path.join(temporary, "link");
    fs.writeFileSync(file, "not a directory");
    fs.mkdirSync(real);
    fs.symlinkSync(real, link);

    for (const [root, error] of [
      [missing, "Project root must be a directory"],
      [file, "Project root must be a directory"],
      [link, "Project root must not be a symbolic link"],
    ]) {
      const result = run(plugin, ["--scope", "project", "--project-root", root]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, new RegExp(error));
      assert.equal(installedFiles(real).length, 0);
    }
  });
});

test("preflights conflicts before writing and updates only managed agents", () => {
  withTemporaryDirectory((temporary) => {
    const plugin = makePlugin(temporary);
    const project = path.join(temporary, "project");
    fs.mkdirSync(destination(project), { recursive: true });
    const unmanaged = path.join(destination(project), "itixo-tester.toml");
    fs.writeFileSync(unmanaged, "name = \"other\"\n", "utf8");

    const failed = run(plugin, ["--scope", "project", "--project-root", project]);
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /Refusing unmanaged existing file/);
    assert.deepEqual(installedFiles(project), ["itixo-tester.toml"]);
    assert.equal(fs.readFileSync(unmanaged, "utf8"), "name = \"other\"\n");

    fs.writeFileSync(unmanaged, `${MARKER}old managed content\n`, "utf8");
    const updated = run(plugin, ["--scope", "project", "--project-root", project]);
    assert.equal(updated.status, 0, updated.stderr);
    assert.match(updated.stdout, /summary installed=7 skipped=0 scope=project cheap-model=luna\n$/);
    assertAgentSet(project);
    assert.notEqual(readAgent(project, "itixo-tester"), `${MARKER}old managed content\n`);

    const idempotent = run(plugin, ["--scope", "project", "--project-root", project]);
    assert.equal(idempotent.status, 0, idempotent.stderr);
    assert.match(idempotent.stdout, /summary installed=0 skipped=7 scope=project cheap-model=luna\n$/);
  });
});

test("refuses symbolic-link and non-file destinations without partial writes", () => {
  withTemporaryDirectory((temporary) => {
    const plugin = makePlugin(temporary);
    const project = path.join(temporary, "project");
    const outside = path.join(temporary, "outside.toml");
    fs.mkdirSync(destination(project), { recursive: true });
    fs.writeFileSync(outside, "outside\n");
    fs.symlinkSync(outside, path.join(destination(project), "itixo-investigator.toml"));

    const linked = run(plugin, ["--scope", "project", "--project-root", project]);
    assert.equal(linked.status, 1);
    assert.match(linked.stderr, /Refusing symbolic-link target/);
    assert.deepEqual(installedFiles(project), ["itixo-investigator.toml"]);
    assert.equal(fs.readFileSync(outside, "utf8"), "outside\n");

    fs.unlinkSync(path.join(destination(project), "itixo-investigator.toml"));
    fs.mkdirSync(path.join(destination(project), "itixo-reviewer.toml"));
    const directory = run(plugin, ["--scope", "project", "--project-root", project]);
    assert.equal(directory.status, 1);
    assert.match(directory.stderr, /Refusing non-file target/);
    assert.deepEqual(installedFiles(project), ["itixo-reviewer.toml"]);
  });
});

test("refuses symbolic-link .codex and agent directories, preserving containment", () => {
  withTemporaryDirectory((temporary) => {
    const plugin = makePlugin(temporary);
    const project = path.join(temporary, "project");
    const outside = path.join(temporary, "outside");
    fs.mkdirSync(project);
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(project, ".codex"));

    const codexLink = run(plugin, ["--scope", "project", "--project-root", project]);
    assert.equal(codexLink.status, 1);
    assert.match(codexLink.stderr, /\.codex directory must not be a symbolic link/);
    assert.deepEqual(fs.readdirSync(outside), []);

    fs.unlinkSync(path.join(project, ".codex"));
    fs.mkdirSync(path.join(project, ".codex"));
    fs.symlinkSync(outside, destination(project));
    const agentLink = run(plugin, ["--scope", "project", "--project-root", project]);
    assert.equal(agentLink.status, 1);
    assert.match(agentLink.stderr, /Agent destination must not be a symbolic link/);
    assert.deepEqual(fs.readdirSync(outside), []);
  });
});

test("fails safely for missing and malformed copied templates", () => {
  withTemporaryDirectory((temporary) => {
    const plugin = makePlugin(temporary);
    const project = path.join(temporary, "project");
    fs.mkdirSync(project);
    const missingTemplate = path.join(plugin, "templates", "agents", "itixo-reviewer.toml");
    fs.unlinkSync(missingTemplate);

    const missing = run(plugin, ["--scope", "project", "--project-root", project]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /Cannot read template/);
    assert.deepEqual(installedFiles(project), []);

    fs.copyFileSync(path.join(SOURCE_PLUGIN, "templates", "agents", "itixo-reviewer.toml"), missingTemplate);
    fs.writeFileSync(missingTemplate, "name = \"itixo-reviewer\"\n", "utf8");
    const malformed = run(plugin, ["--scope", "project", "--project-root", project]);
    assert.equal(malformed.status, 1);
    assert.match(malformed.stderr, /missing required Itixo markers/);
    assert.deepEqual(installedFiles(project), []);
  });
});
