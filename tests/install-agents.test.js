"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { install } = require("../plugins/codex/itixo/scripts/install-agents.js");

const ROOT = path.join(__dirname, "..");
const SOURCE_PLUGIN = path.join(ROOT, "plugins", "codex", "itixo");
const AGENT_IDS = [
  "itixo-builder",
  "itixo-docs-updater",
  "itixo-github-issues",
  "itixo-investigator",
  "itixo-planner",
  "itixo-reviewer",
  "itixo-security-reviewer",
  "itixo-tester",
];
const MARKER = "# Itixo-managed custom agent. Do not edit.\n";
const DEFAULT_SETTINGS = {
  "itixo-builder": { model: "gpt-5.6-terra", effort: "medium" },
  "itixo-docs-updater": { model: "gpt-5.6-luna", effort: "high" },
  "itixo-github-issues": { model: "gpt-5.6-terra", effort: "medium" },
  "itixo-investigator": { model: "gpt-5.6-luna", effort: "high" },
  "itixo-planner": { model: null, effort: null },
  "itixo-reviewer": { model: "gpt-5.6-terra", effort: "medium" },
  "itixo-security-reviewer": { model: "gpt-5.6-sol", effort: "max" },
  "itixo-tester": { model: "gpt-5.6-terra", effort: "medium" },
};

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

function assertAgentSettings(root, agentId, { model, effort }) {
  const content = readAgent(root, agentId);
  if (model === null) {
    assert.doesNotMatch(content, /^model =/m, `${agentId} model`);
  } else {
    assert.match(content, new RegExp(`^model = "${model.replaceAll(".", "\\.")}"$`, "m"), `${agentId} model`);
  }
  if (effort === null) {
    assert.doesNotMatch(content, /^model_reasoning_effort =/m, `${agentId} effort`);
  } else {
    assert.match(content, new RegExp(`^model_reasoning_effort = "${effort}"$`, "m"), `${agentId} effort`);
  }
}

function repeatedOverrideArguments(flag, values) {
  return values.flatMap(([agentId, value]) => [flag, `${agentId}=${value}`]);
}

function runInstallQuietly(options, dependencies) {
  const originalLog = console.log;
  const output = [];
  console.log = (...values) => output.push(values.join(" "));
  try {
    install(options, dependencies);
  } finally {
    console.log = originalLog;
  }
  return output;
}

function temporaryFiles(root) {
  return fs.readdirSync(destination(root)).filter((name) => name.endsWith(".tmp"));
}

test("installs exactly eight default custom agents into an isolated personal home", () => {
  withTemporaryDirectory((temporary) => {
    const plugin = makePlugin(temporary);
    const home = path.join(temporary, "home");
    fs.mkdirSync(home);

    const result = run(plugin, ["--scope", "personal"], { HOME: home });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /^installed .+\n/m);
    assert.match(result.stdout, /summary installed=8 skipped=0 scope=personal cheap-model=luna cheap-effort=high\n$/);
    assertAgentSet(home);
    for (const agentId of ["itixo-investigator", "itixo-docs-updater"]) {
      assert.match(readAgent(home, agentId), /^model = "gpt-5\.6-luna"$/m);
      assert.match(readAgent(home, agentId), /^model_reasoning_effort = "high"$/m);
    }
    for (const agentId of ["itixo-builder", "itixo-github-issues", "itixo-tester", "itixo-reviewer"]) {
      assert.match(readAgent(home, agentId), /^model = "gpt-5\.6-terra"$/m);
      assert.match(readAgent(home, agentId), /^model_reasoning_effort = "medium"$/m);
    }
    assert.doesNotMatch(readAgent(home, "itixo-planner"), /^model(?:_reasoning_effort)? =/m);
    assertAgentSettings(home, "itixo-security-reviewer", { model: "gpt-5.6-sol", effort: "max" });
  });
});

test("defaults an explicit Terra cheap model to low effort", () => {
  withTemporaryDirectory((temporary) => {
    const plugin = makePlugin(temporary);
    const project = path.join(temporary, "project");
    fs.mkdirSync(project);

    const result = run(plugin, ["--scope", "project", "--project-root", project, "--cheap-model", "terra"]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /summary installed=8 skipped=0 scope=project cheap-model=terra cheap-effort=low\n$/);
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

test("uses default Luna model for an effort-only cheap override", () => {
  withTemporaryDirectory((temporary) => {
    const plugin = makePlugin(temporary);
    const project = path.join(temporary, "project");
    fs.mkdirSync(project);

    const result = run(plugin, ["--scope", "project", "--project-root", project, "--cheap-effort", "low"]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /summary installed=8 skipped=0 scope=project cheap-model=luna cheap-effort=low\n$/);
    for (const agentId of ["itixo-investigator", "itixo-docs-updater"]) {
      assert.match(readAgent(project, agentId), /^model = "gpt-5\.6-luna"$/m);
      assert.match(readAgent(project, agentId), /^model_reasoning_effort = "low"$/m);
    }
  });
});

test("accepts every model alias for every agent as a model-only override", () => {
  withTemporaryDirectory((temporary) => {
    const plugin = makePlugin(temporary);
    for (const alias of ["sol", "terra", "luna"]) {
      const project = path.join(temporary, `model-${alias}`);
      fs.mkdirSync(project);
      const overrides = AGENT_IDS.map((agentId) => [agentId, alias]);
      const result = run(plugin, [
        "--scope", "project", "--project-root", project,
        ...repeatedOverrideArguments("--agent-model", [...overrides].reverse()),
      ]);

      assert.equal(result.status, 0, result.stderr);
      assert.match(
        result.stdout,
        new RegExp(`summary installed=8 skipped=0 scope=project cheap-model=luna cheap-effort=high agent-models=${overrides.map(([agentId]) => `${agentId}:${alias}`).join(",")}\\n$`),
      );
      for (const agentId of AGENT_IDS) {
        assertAgentSettings(project, agentId, {
          model: `gpt-5.6-${alias}`,
          effort: DEFAULT_SETTINGS[agentId].effort,
        });
      }
    }
  });
});

test("accepts every effort for every agent as an effort-only override", () => {
  withTemporaryDirectory((temporary) => {
    const plugin = makePlugin(temporary);
    for (const effort of ["none", "low", "medium", "high", "xhigh", "max"]) {
      const project = path.join(temporary, `effort-${effort}`);
      fs.mkdirSync(project);
      const overrides = AGENT_IDS.map((agentId) => [agentId, effort]);
      const result = run(plugin, [
        "--scope", "project", "--project-root", project,
        ...repeatedOverrideArguments("--agent-effort", [...overrides].reverse()),
      ]);

      assert.equal(result.status, 0, result.stderr);
      assert.match(
        result.stdout,
        new RegExp(`summary installed=8 skipped=0 scope=project cheap-model=luna cheap-effort=high agent-efforts=${overrides.map(([agentId]) => `${agentId}:${effort}`).join(",")}\\n$`),
      );
      for (const agentId of AGENT_IDS) {
        assertAgentSettings(project, agentId, {
          model: DEFAULT_SETTINGS[agentId].model,
          effort: effort === "none" ? null : effort,
        });
      }
    }
  });
});

test("installs explicit planner Sol and max overrides together", () => {
  withTemporaryDirectory((temporary) => {
    const plugin = makePlugin(temporary);
    const project = path.join(temporary, "project");
    fs.mkdirSync(project);

    const result = run(plugin, [
      "--scope", "project", "--project-root", project,
      "--agent-model", "itixo-planner=sol",
      "--agent-effort", "itixo-planner=max",
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /summary installed=8 skipped=0 scope=project cheap-model=luna cheap-effort=high agent-models=itixo-planner:sol agent-efforts=itixo-planner:max\n$/,
    );
    assertAgentSettings(project, "itixo-planner", { model: "gpt-5.6-sol", effort: "max" });
  });
});

test("per-agent fields independently override compatible cheap-role flags", () => {
  withTemporaryDirectory((temporary) => {
    const plugin = makePlugin(temporary);
    const project = path.join(temporary, "project");
    fs.mkdirSync(project);

    const result = run(plugin, [
      "--scope", "project", "--project-root", project,
      "--cheap-model", "terra", "--cheap-effort", "low",
      "--agent-effort", "itixo-investigator=xhigh",
      "--agent-model", "itixo-docs-updater=luna",
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /summary installed=8 skipped=0 scope=project cheap-model=terra cheap-effort=low agent-models=itixo-docs-updater:luna agent-efforts=itixo-investigator:xhigh\n$/,
    );
    assertAgentSettings(project, "itixo-docs-updater", { model: "gpt-5.6-luna", effort: "low" });
    assertAgentSettings(project, "itixo-investigator", { model: "gpt-5.6-terra", effort: "xhigh" });
  });
});

test("installs every explicit cheap model and effort combination", () => {
  withTemporaryDirectory((temporary) => {
    const plugin = makePlugin(temporary);
    for (const cheapModel of ["luna", "terra"]) {
      for (const cheapEffort of ["high", "low"]) {
        const project = path.join(temporary, `${cheapModel}-${cheapEffort}`);
        fs.mkdirSync(project);

        const result = run(plugin, [
          "--scope", "project", "--project-root", project,
          "--cheap-model", cheapModel, "--cheap-effort", cheapEffort,
        ]);

        assert.equal(result.status, 0, result.stderr);
        assert.match(
          result.stdout,
          new RegExp(`summary installed=8 skipped=0 scope=project cheap-model=${cheapModel} cheap-effort=${cheapEffort}\\n$`),
        );
        for (const agentId of ["itixo-investigator", "itixo-docs-updater"]) {
          assert.match(readAgent(project, agentId), new RegExp(`^model = "gpt-5\\.6-${cheapModel}"$`, "m"));
          assert.match(readAgent(project, agentId), new RegExp(`^model_reasoning_effort = "${cheapEffort}"$`, "m"));
        }
        for (const agentId of ["itixo-builder", "itixo-github-issues", "itixo-tester", "itixo-reviewer"]) {
          assert.match(readAgent(project, agentId), /^model = "gpt-5\.6-terra"$/m);
          assert.match(readAgent(project, agentId), /^model_reasoning_effort = "medium"$/m);
        }
        assert.doesNotMatch(readAgent(project, "itixo-planner"), /^model(?:_reasoning_effort)? =/m);
      }
    }
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
      { args: ["--scope", "project", "--project-root", project, "--cheap-model", "other"], error: "Invalid cheap model." },
      { args: ["--scope", "project", "--project-root", project, "--cheap-effort", "medium"], error: "Invalid cheap effort." },
      {
        args: ["--scope", "project", "--project-root", project, "--agent-model", "itixo-planner=sol", "--agent-model", "itixo-planner=terra"],
        error: "Duplicate agent model override",
      },
      {
        args: ["--scope", "project", "--project-root", project, "--agent-effort", "itixo-planner=low", "--agent-effort", "itixo-planner=max"],
        error: "Duplicate agent effort override",
      },
      {
        args: ["--scope", "project", "--project-root", project, "--agent-model", "unknown=sol"],
        error: "Unknown agent ID 'unknown'",
      },
      {
        args: ["--scope", "project", "--project-root", project, "--agent-effort", "unknown=max"],
        error: "Unknown agent ID 'unknown'",
      },
      {
        args: ["--scope", "project", "--project-root", project, "--agent-model", "itixo-planner=opus"],
        error: "Invalid agent model 'opus'",
      },
      {
        args: ["--scope", "project", "--project-root", project, "--agent-effort", "itixo-planner=ultra"],
        error: "Invalid agent effort 'ultra'",
      },
      {
        args: ["--scope", "project", "--project-root", project, "--agent-model", "itixo-planner"],
        error: "Malformed agent model override",
      },
      {
        args: ["--scope", "project", "--project-root", project, "--agent-effort", "=max"],
        error: "Malformed agent effort override",
      },
      {
        args: ["--scope", "project", "--project-root", project, "--agent-model", "itixo-planner="],
        error: "Malformed agent model override",
      },
      {
        args: ["--scope", "project", "--project-root", project, "--agent-effort"],
        error: "Argument '--agent-effort' requires a value.",
      },
      {
        args: ["--scope", "project", "--project-root", project, "--agent-model"],
        error: "Argument '--agent-model' requires a value.",
      },
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
    assert.match(updated.stdout, /summary installed=8 skipped=0 scope=project cheap-model=luna cheap-effort=high\n$/);
    assertAgentSet(project);
    assert.notEqual(readAgent(project, "itixo-tester"), `${MARKER}old managed content\n`);

    const idempotent = run(plugin, ["--scope", "project", "--project-root", project]);
    assert.equal(idempotent.status, 0, idempotent.stderr);
    assert.match(idempotent.stdout, /summary installed=0 skipped=8 scope=project cheap-model=luna cheap-effort=high\n$/);
  });
});

test("reinstalling identical overrides is idempotent and changing one field updates one agent", () => {
  withTemporaryDirectory((temporary) => {
    const plugin = makePlugin(temporary);
    const project = path.join(temporary, "project");
    fs.mkdirSync(project);
    const baseArgs = [
      "--scope", "project", "--project-root", project,
      "--agent-model", "itixo-planner=sol",
      "--agent-effort", "itixo-planner=max",
    ];

    const installed = run(plugin, baseArgs);
    assert.equal(installed.status, 0, installed.stderr);
    assert.match(installed.stdout, /summary installed=8 skipped=0 .*agent-models=itixo-planner:sol agent-efforts=itixo-planner:max\n$/);

    const idempotent = run(plugin, baseArgs);
    assert.equal(idempotent.status, 0, idempotent.stderr);
    assert.match(idempotent.stdout, /summary installed=0 skipped=8 .*agent-models=itixo-planner:sol agent-efforts=itixo-planner:max\n$/);

    const changed = run(plugin, [
      "--scope", "project", "--project-root", project,
      "--agent-model", "itixo-planner=sol",
      "--agent-effort", "itixo-planner=xhigh",
    ]);
    assert.equal(changed.status, 0, changed.stderr);
    assert.match(changed.stdout, /summary installed=1 skipped=7 .*agent-models=itixo-planner:sol agent-efforts=itixo-planner:xhigh\n$/);
    assertAgentSettings(project, "itixo-planner", { model: "gpt-5.6-sol", effort: "xhigh" });
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

test("rolls back every completed write after an injected mid-sequence rename failure", () => {
  withTemporaryDirectory((temporary) => {
    const project = path.join(temporary, "project");
    fs.mkdirSync(destination(project), { recursive: true });
    const originals = new Map([
      ["itixo-builder", Buffer.from(`${MARKER}original builder\n`, "utf8")],
      ["itixo-github-issues", Buffer.from(`${MARKER}original GitHub issues\n`, "utf8")],
    ]);
    for (const [agentId, content] of originals) {
      fs.writeFileSync(path.join(destination(project), `${agentId}.toml`), content);
    }
    const unrelatedPath = path.join(destination(project), "personal-agent.toml");
    const unrelatedContent = Buffer.from("name = \"personal-agent\"\n", "utf8");
    fs.writeFileSync(unrelatedPath, unrelatedContent);

    let renameCount = 0;
    const injectedRename = (source, target) => {
      renameCount += 1;
      if (renameCount === 4) throw new Error("injected rename failure");
      fs.renameSync(source, target);
    };

    assert.throws(
      () => runInstallQuietly(
        { scope: "project", projectRoot: project, cheapModel: "luna", cheapEffort: "high" },
        { renameSync: injectedRename },
      ),
      /injected rename failure/,
    );
    assert.equal(renameCount, 4);
    for (const [agentId, content] of originals) {
      assert.deepEqual(fs.readFileSync(path.join(destination(project), `${agentId}.toml`)), content);
    }
    for (const agentId of AGENT_IDS.filter((agentId) => !originals.has(agentId))) {
      assert.equal(fs.existsSync(path.join(destination(project), `${agentId}.toml`)), false);
    }
    assert.deepEqual(fs.readFileSync(unrelatedPath), unrelatedContent);
    assert.deepEqual(temporaryFiles(project), []);
  });
});

test("revalidates a target swapped between adjacent atomic writes", () => {
  withTemporaryDirectory((temporary) => {
    const project = path.join(temporary, "project");
    fs.mkdirSync(destination(project), { recursive: true });
    const builderPath = path.join(destination(project), "itixo-builder.toml");
    const docsPath = path.join(destination(project), "itixo-docs-updater.toml");
    const builderOriginal = Buffer.from(`${MARKER}original builder\n`, "utf8");
    const docsOriginal = Buffer.from(`${MARKER}original docs\n`, "utf8");
    const swappedDocs = Buffer.from(`${MARKER}externally swapped docs\n`, "utf8");
    fs.writeFileSync(builderPath, builderOriginal);
    fs.writeFileSync(docsPath, docsOriginal);

    let renameCount = 0;
    const swapAfterFirstRename = (source, target) => {
      fs.renameSync(source, target);
      renameCount += 1;
      if (renameCount === 1) {
        const replacement = path.join(temporary, "replacement.toml");
        fs.writeFileSync(replacement, swappedDocs);
        fs.renameSync(replacement, docsPath);
      }
    };

    assert.throws(
      () => runInstallQuietly(
        { scope: "project", projectRoot: project, cheapModel: "luna", cheapEffort: "high" },
        { renameSync: swapAfterFirstRename },
      ),
      /Agent target changed during installation/,
    );
    assert.equal(renameCount, 1);
    assert.deepEqual(fs.readFileSync(builderPath), builderOriginal);
    assert.deepEqual(fs.readFileSync(docsPath), swappedDocs);
    for (const agentId of AGENT_IDS.slice(2)) {
      assert.equal(fs.existsSync(path.join(destination(project), `${agentId}.toml`)), false);
    }
    assert.deepEqual(temporaryFiles(project), []);
  });
});

test("revalidates a destination swapped between adjacent atomic writes", () => {
  withTemporaryDirectory((temporary) => {
    const project = path.join(temporary, "project");
    const displacedDestination = path.join(temporary, "displaced-agents");
    fs.mkdirSync(destination(project), { recursive: true });
    const unrelatedPath = path.join(destination(project), "personal-agent.toml");
    const unrelatedContent = Buffer.from("name = \"personal-agent\"\n", "utf8");
    fs.writeFileSync(unrelatedPath, unrelatedContent);

    let renameCount = 0;
    const swapAfterFirstRename = (source, target) => {
      fs.renameSync(source, target);
      renameCount += 1;
      if (renameCount === 1) {
        fs.renameSync(destination(project), displacedDestination);
        fs.mkdirSync(destination(project));
      }
    };

    assert.throws(
      () => runInstallQuietly(
        { scope: "project", projectRoot: project, cheapModel: "luna", cheapEffort: "high" },
        { renameSync: swapAfterFirstRename },
      ),
      /Agent destination changed during installation:.*; rollback failed:/,
    );
    assert.equal(renameCount, 1);
    assert.deepEqual(fs.readdirSync(destination(project)), []);
    assert.deepEqual(fs.readFileSync(path.join(displacedDestination, "personal-agent.toml")), unrelatedContent);
    assert.deepEqual(fs.readdirSync(displacedDestination).filter((name) => name.endsWith(".tmp")), []);
  });
});
