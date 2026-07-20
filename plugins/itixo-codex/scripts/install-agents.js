#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const PLUGIN_ROOT = path.resolve(__dirname, "..");
const TEMPLATE_DIRECTORY = path.join(PLUGIN_ROOT, "templates", "agents");
const MANAGED_MARKER = "# Itixo-managed custom agent. Do not edit.\n";
const CHEAP_AGENT_IDS = new Set(["itixo-investigator", "itixo-docs-updater"]);
const AGENT_IDS = [
  "itixo-builder",
  "itixo-docs-updater",
  "itixo-github-issues",
  "itixo-investigator",
  "itixo-planner",
  "itixo-reviewer",
  "itixo-tester",
];

function fail(message) {
  throw new Error(message);
}

function usage() {
  return [
    "Usage:",
    "  node install-agents.js --scope personal [--cheap-model terra]",
    "  node install-agents.js --scope project --project-root <path> [--cheap-model terra]",
  ].join("\n");
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      return { help: true };
    }
    if (!new Set(["--scope", "--project-root", "--cheap-model"]).has(argument)) {
      fail(`Unknown argument '${argument}'.\n${usage()}`);
    }
    if (Object.hasOwn(values, argument)) {
      fail(`Argument '${argument}' may be specified only once.\n${usage()}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`Argument '${argument}' requires a value.\n${usage()}`);
    }
    values[argument] = value;
    index += 1;
  }

  if (!values["--scope"]) fail(`Argument '--scope' is required.\n${usage()}`);
  if (!["personal", "project"].includes(values["--scope"])) {
    fail(`Invalid scope '${values["--scope"]}'. Use 'personal' or 'project'.`);
  }
  if (values["--scope"] === "project" && !values["--project-root"]) {
    fail(`Argument '--project-root' is required when scope is 'project'.\n${usage()}`);
  }
  if (values["--scope"] === "personal" && values["--project-root"]) {
    fail("Argument '--project-root' is valid only when scope is 'project'.");
  }
  if (values["--cheap-model"] && values["--cheap-model"] !== "terra") {
    fail("Invalid cheap model. Only '--cheap-model terra' is supported.");
  }

  return {
    scope: values["--scope"],
    projectRoot: values["--project-root"],
    cheapModel: values["--cheap-model"] || "luna",
  };
}

function existingDirectory(realPath, label) {
  let stat;
  try {
    stat = fs.lstatSync(realPath);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  if (stat.isSymbolicLink()) fail(`${label} must not be a symbolic link: ${realPath}`);
  if (!stat.isDirectory()) fail(`${label} must be a directory: ${realPath}`);
  return true;
}

function resolveDestination(options) {
  let root;
  if (options.scope === "personal") {
    root = fs.realpathSync(os.homedir());
  } else {
    const suppliedRoot = path.resolve(options.projectRoot);
    if (!existingDirectory(suppliedRoot, "Project root")) {
      fail(`Project root must be a directory: ${suppliedRoot}`);
    }
    root = fs.realpathSync(suppliedRoot);
  }

  const codexDirectory = path.resolve(root, ".codex");
  const destination = path.resolve(codexDirectory, "agents");
  ensureContained(root, destination, "Agent destination");
  existingDirectory(codexDirectory, ".codex directory");
  existingDirectory(destination, "Agent destination");
  return destination;
}

function ensureContained(root, target, label) {
  const relative = path.relative(root, target);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail(`${label} escapes its allowed root.`);
  }
}

function readTemplate(agentId, cheapModel) {
  const templatePath = path.join(TEMPLATE_DIRECTORY, `${agentId}.toml`);
  let content;
  try {
    content = fs.readFileSync(templatePath, "utf8");
  } catch (error) {
    fail(`Cannot read template '${templatePath}': ${error.message}`);
  }
  validateTemplate(agentId, templatePath, content);

  if (cheapModel === "terra" && CHEAP_AGENT_IDS.has(agentId)) {
    const expected = 'model = "gpt-5.6-luna"';
    if ((content.match(/model = "gpt-5\.6-luna"/g) || []).length !== 1) {
      fail(`Template '${templatePath}' has unexpected Luna model structure.`);
    }
    content = content.replace(expected, 'model = "gpt-5.6-terra"');
    if (!content.includes('model_reasoning_effort = "low"')) {
      fail(`Template '${templatePath}' must keep low reasoning effort for Terra fallback.`);
    }
  }
  return content;
}

function validateTemplate(agentId, templatePath, content) {
  const sourceMarker = `# Generated from base/agents/${agentId}.md by scripts/generate-agents.js.\n`;
  if (!content.startsWith(MANAGED_MARKER + sourceMarker)) {
    fail(`Template '${templatePath}' is missing required Itixo markers.`);
  }
  if (!content.includes(`name = "${agentId}"\n`)) {
    fail(`Template '${templatePath}' has unexpected agent name.`);
  }
  if (!/^description = "[^"\n]+"$/m.test(content) || !/^developer_instructions = """[\s\S]*"""\n?$/m.test(content)) {
    fail(`Template '${templatePath}' has invalid custom agent fields.`);
  }

  const modelLines = content.match(/^model = .+$/gm) || [];
  const effortLines = content.match(/^model_reasoning_effort = .+$/gm) || [];
  if (agentId === "itixo-planner") {
    if (modelLines.length !== 0 || effortLines.length !== 0) {
      fail(`Planner template '${templatePath}' must inherit model and reasoning effort.`);
    }
    return;
  }

  const expectedModel = CHEAP_AGENT_IDS.has(agentId) ? "gpt-5.6-luna" : "gpt-5.6-terra";
  const expectedEffort = CHEAP_AGENT_IDS.has(agentId) ? "low" : "medium";
  if (modelLines.length !== 1 || modelLines[0] !== `model = "${expectedModel}"`) {
    fail(`Template '${templatePath}' has unexpected model.`);
  }
  if (effortLines.length !== 1 || effortLines[0] !== `model_reasoning_effort = "${expectedEffort}"`) {
    fail(`Template '${templatePath}' has unexpected reasoning effort.`);
  }
}

function preflight(destination, templates) {
  const targets = [];
  for (const [agentId, content] of templates) {
    const target = path.resolve(destination, `${agentId}.toml`);
    ensureContained(destination, target, `Agent target '${agentId}'`);
    let existing = null;
    try {
      existing = fs.lstatSync(target);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (existing) {
      if (existing.isSymbolicLink()) fail(`Refusing symbolic-link target: ${target}`);
      if (!existing.isFile()) fail(`Refusing non-file target: ${target}`);
      const current = fs.readFileSync(target, "utf8");
      if (!current.startsWith(MANAGED_MARKER)) {
        fail(`Refusing unmanaged existing file: ${target}`);
      }
      targets.push({ agentId, content, target, action: current === content ? "skipped" : "installed" });
    } else {
      targets.push({ agentId, content, target, action: "installed" });
    }
  }
  return targets;
}

function writeAtomically(target, content) {
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  try {
    fs.writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, target);
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

function install(options) {
  const destination = resolveDestination(options);
  const templates = AGENT_IDS.map((agentId) => [agentId, readTemplate(agentId, options.cheapModel)]);
  const targets = preflight(destination, templates);

  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  let installed = 0;
  let skipped = 0;
  for (const entry of targets) {
    if (entry.action === "skipped") {
      skipped += 1;
      console.log(`skipped ${entry.target}`);
      continue;
    }
    writeAtomically(entry.target, entry.content);
    installed += 1;
    console.log(`installed ${entry.target}`);
  }
  console.log(`summary installed=${installed} skipped=${skipped} scope=${options.scope} cheap-model=${options.cheapModel}`);
}

function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }
    install(options);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { AGENT_IDS, MANAGED_MARKER, install, parseArguments, readTemplate, resolveDestination };
