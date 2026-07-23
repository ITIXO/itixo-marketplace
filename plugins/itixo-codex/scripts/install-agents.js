#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const PLUGIN_ROOT = path.resolve(__dirname, "..");
const TEMPLATE_DIRECTORY = path.join(PLUGIN_ROOT, "templates", "agents");
const MANAGED_MARKER = "# Itixo-managed custom agent. Do not edit.\n";
const NOFOLLOW_FLAG = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
const CHEAP_AGENT_IDS = new Set(["itixo-investigator", "itixo-docs-updater"]);
const CHEAP_MODELS = new Set(["luna", "terra"]);
const CHEAP_EFFORTS = new Set(["high", "low"]);
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
    "  node install-agents.js --scope personal [--cheap-model luna|terra] [--cheap-effort high|low]",
    "  node install-agents.js --scope project --project-root <path> [--cheap-model luna|terra] [--cheap-effort high|low]",
  ].join("\n");
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      return { help: true };
    }
    if (!new Set(["--scope", "--project-root", "--cheap-model", "--cheap-effort"]).has(argument)) {
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
  if (values["--cheap-model"] && !CHEAP_MODELS.has(values["--cheap-model"])) {
    fail("Invalid cheap model. Use 'luna' or 'terra'.");
  }
  if (values["--cheap-effort"] && !CHEAP_EFFORTS.has(values["--cheap-effort"])) {
    fail("Invalid cheap effort. Use 'high' or 'low'.");
  }

  const cheapModel = values["--cheap-model"] || "luna";

  return {
    scope: values["--scope"],
    projectRoot: values["--project-root"],
    cheapModel,
    cheapEffort: values["--cheap-effort"] || (cheapModel === "luna" ? "high" : "low"),
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

function readTemplate(agentId, cheapModel, cheapEffort) {
  const selectedCheapModel = cheapModel || "luna";
  const selectedCheapEffort = cheapEffort || (selectedCheapModel === "luna" ? "high" : "low");
  const templatePath = path.join(TEMPLATE_DIRECTORY, `${agentId}.toml`);
  let content;
  try {
    content = fs.readFileSync(templatePath, "utf8");
  } catch (error) {
    fail(`Cannot read template '${templatePath}': ${error.message}`);
  }
  validateTemplate(agentId, templatePath, content);

  if (CHEAP_AGENT_IDS.has(agentId)) {
    const expectedModel = 'model = "gpt-5.6-luna"';
    const expectedEffort = 'model_reasoning_effort = "high"';
    if ((content.match(/model = "gpt-5\.6-luna"/g) || []).length !== 1) {
      fail(`Template '${templatePath}' has unexpected Luna model structure.`);
    }
    if ((content.match(/model_reasoning_effort = "high"/g) || []).length !== 1) {
      fail(`Template '${templatePath}' has unexpected high reasoning effort structure.`);
    }
    content = content
      .replace(expectedModel, `model = "gpt-5.6-${selectedCheapModel}"`)
      .replace(expectedEffort, `model_reasoning_effort = "${selectedCheapEffort}"`);
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
  const expectedEffort = CHEAP_AGENT_IDS.has(agentId) ? "high" : "medium";
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
      const current = readRegularFileWithoutFollowing(target, existing);
      if (!current.toString("utf8").startsWith(MANAGED_MARKER)) {
        fail(`Refusing unmanaged existing file: ${target}`);
      }
      targets.push({
        agentId,
        content: Buffer.from(content, "utf8"),
        target,
        action: current.equals(Buffer.from(content, "utf8")) ? "skipped" : "installed",
        original: { exists: true, identity: fileIdentity(existing), content: current },
      });
    } else {
      targets.push({
        agentId,
        content: Buffer.from(content, "utf8"),
        target,
        action: "installed",
        original: { exists: false },
      });
    }
  }
  return targets;
}

function fileIdentity(stat) {
  return { dev: stat.dev, ino: stat.ino };
}

function sameIdentity(stat, identity) {
  return stat.dev === identity.dev && stat.ino === identity.ino;
}

function readRegularFileWithoutFollowing(target, expectedStat) {
  const flags = fs.constants.O_RDONLY | NOFOLLOW_FLAG;
  let descriptor;
  try {
    descriptor = fs.openSync(target, flags);
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile()) fail(`Refusing non-file target: ${target}`);
    if (expectedStat && !sameIdentity(opened, fileIdentity(expectedStat))) {
      fail(`Target changed during validation: ${target}`);
    }
    return fs.readFileSync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function captureDestinationState(destination) {
  const stat = fs.lstatSync(destination);
  if (stat.isSymbolicLink()) fail(`Agent destination must not be a symbolic link: ${destination}`);
  if (!stat.isDirectory()) fail(`Agent destination must be a directory: ${destination}`);
  const realPath = fs.realpathSync(destination);
  if (realPath !== path.resolve(destination)) {
    fail(`Agent destination resolves outside its expected path: ${destination}`);
  }
  return { path: destination, realPath, identity: fileIdentity(stat) };
}

function validateDestinationState(destinationState) {
  const stat = fs.lstatSync(destinationState.path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail(`Agent destination changed during installation: ${destinationState.path}`);
  }
  if (!sameIdentity(stat, destinationState.identity) || fs.realpathSync(destinationState.path) !== destinationState.realPath) {
    fail(`Agent destination changed during installation: ${destinationState.path}`);
  }
}

function lstatIfPresent(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function validateTargetState(destinationState, target, expected) {
  validateDestinationState(destinationState);
  ensureContained(destinationState.realPath, target, `Agent target '${path.basename(target)}'`);
  const parentRealPath = fs.realpathSync(path.dirname(target));
  if (parentRealPath !== destinationState.realPath) {
    fail(`Agent target parent changed during installation: ${target}`);
  }

  const stat = lstatIfPresent(target);
  if (!stat) {
    if (expected.exists) fail(`Agent target disappeared during installation: ${target}`);
    return { exists: false };
  }
  if (stat.isSymbolicLink()) fail(`Refusing symbolic-link target: ${target}`);
  if (!stat.isFile()) fail(`Refusing non-file target: ${target}`);
  if (!expected.exists) fail(`Agent target appeared during installation: ${target}`);
  if (expected.identity && !sameIdentity(stat, expected.identity)) {
    fail(`Agent target changed during installation: ${target}`);
  }
  const content = readRegularFileWithoutFollowing(target, stat);
  if (expected.content && !content.equals(expected.content)) {
    fail(`Agent target content changed during installation: ${target}`);
  }
  return { exists: true, identity: fileIdentity(stat), content };
}

function cleanupTemporary(temporary, temporaryIdentity) {
  const stat = lstatIfPresent(temporary);
  if (!stat) return;
  if (!temporaryIdentity || stat.isSymbolicLink() || !stat.isFile() || !sameIdentity(stat, temporaryIdentity)) {
    fail(`Refusing to remove changed temporary file: ${temporary}`);
  }
  fs.unlinkSync(temporary);
}

function writeAtomically(target, content, destinationState, expectedTarget, renameSync, onRenamed = () => {}) {
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  let descriptor;
  let temporaryIdentity;
  let operationError;
  try {
    validateTargetState(destinationState, target, expectedTarget);
    ensureContained(destinationState.realPath, temporary, "Temporary agent file");
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW_FLAG;
    descriptor = fs.openSync(temporary, flags, 0o600);
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile()) fail(`Temporary agent path is not a file: ${temporary}`);
    temporaryIdentity = fileIdentity(opened);
    fs.writeFileSync(descriptor, content);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;

    validateTargetState(destinationState, target, expectedTarget);
    const temporaryStat = fs.lstatSync(temporary);
    if (temporaryStat.isSymbolicLink() || !temporaryStat.isFile() || !sameIdentity(temporaryStat, temporaryIdentity)) {
      fail(`Temporary agent file changed before rename: ${temporary}`);
    }
    if (fs.realpathSync(path.dirname(temporary)) !== destinationState.realPath) {
      fail(`Temporary agent parent changed before rename: ${temporary}`);
    }
    renameSync(temporary, target);
    onRenamed();
  } catch (error) {
    operationError = error;
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch (error) {
        if (!operationError) operationError = error;
      }
    }
    try {
      cleanupTemporary(temporary, temporaryIdentity);
    } catch (error) {
      if (operationError) {
        operationError = new Error(`${operationError.message}; temporary cleanup failed: ${error.message}`);
      } else {
        operationError = error;
      }
    }
  }
  if (operationError) throw operationError;
}

function rollbackChanges(changes, destinationState) {
  const failures = [];
  for (const change of [...changes].reverse()) {
    try {
      const current = validateTargetState(destinationState, change.target, {
        exists: true,
        content: change.installedContent,
      });
      if (change.original.exists) {
        writeAtomically(
          change.target,
          change.original.content,
          destinationState,
          current,
          fs.renameSync,
        );
      } else {
        validateTargetState(destinationState, change.target, current);
        fs.unlinkSync(change.target);
      }
    } catch (error) {
      failures.push(`${change.target}: ${error.message}`);
    }
  }
  return failures;
}

function install(options, dependencies = {}) {
  const renameSync = dependencies.renameSync || fs.renameSync;
  if (typeof renameSync !== "function") fail("renameSync dependency must be a function.");
  const cheapModel = options.cheapModel || "luna";
  const cheapEffort = options.cheapEffort || (cheapModel === "luna" ? "high" : "low");
  const destination = resolveDestination(options);
  const templates = AGENT_IDS.map((agentId) => [agentId, readTemplate(agentId, cheapModel, cheapEffort)]);
  const targets = preflight(destination, templates);

  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  const destinationState = captureDestinationState(destination);
  for (const entry of targets) validateTargetState(destinationState, entry.target, entry.original);

  const changes = [];
  try {
    for (const entry of targets) {
      if (entry.action === "skipped") continue;
      writeAtomically(
        entry.target,
        entry.content,
        destinationState,
        entry.original,
        renameSync,
        () => changes.push({
          target: entry.target,
          original: entry.original,
          installedContent: entry.content,
        }),
      );
    }
  } catch (error) {
    const rollbackFailures = rollbackChanges(changes, destinationState);
    const detail = rollbackFailures.length > 0 ? `; rollback failed: ${rollbackFailures.join(" | ")}` : "";
    throw new Error(`${error.message}${detail}`);
  }

  const installed = targets.filter((entry) => entry.action === "installed").length;
  const skipped = targets.length - installed;
  for (const entry of targets) console.log(`${entry.action} ${entry.target}`);
  console.log(
    `summary installed=${installed} skipped=${skipped} scope=${options.scope} cheap-model=${cheapModel} cheap-effort=${cheapEffort}`,
  );
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
