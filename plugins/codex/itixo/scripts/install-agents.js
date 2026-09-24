#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const MODEL_CATALOG = require("./model-catalog.json");

const PLUGIN_ROOT = path.resolve(__dirname, "..");
const TEMPLATE_DIRECTORY = path.join(PLUGIN_ROOT, "templates", "agents");
const MANAGED_MARKER = "# Itixo-managed custom agent. Do not edit.\n";
const NOFOLLOW_FLAG = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
const CHEAP_AGENT_IDS = new Set(["itixo-investigator", "itixo-docs-updater"]);
const SECURITY_REVIEWER_AGENT_ID = "itixo-security-reviewer";
const CODEX_CATALOG = validateCatalog(MODEL_CATALOG);
const CHEAP_MODEL_ALIASES = CODEX_CATALOG.cheapModels;
const CHEAP_MODELS = new Set(Object.keys(CHEAP_MODEL_ALIASES));
const CHEAP_EFFORTS = new Set(CODEX_CATALOG.cheapEfforts);
const AGENT_MODEL_ALIASES = Object.freeze({
  ...CODEX_CATALOG.aliases,
  ...Object.fromEntries(Object.keys(CODEX_CATALOG.effortsByModel).map((model) => [model, model])),
});
const AGENT_EFFORTS = new Set(["none", ...new Set(Object.values(CODEX_CATALOG.effortsByModel).flat())]);
const GPT_6_EFFORTS = Object.freeze(Object.fromEntries(
  Object.entries(CODEX_CATALOG.effortsByModel).map(([model, efforts]) => [model, new Set(efforts)]),
));
const REPEATABLE_ARGUMENTS = new Set(["--agent-model", "--agent-effort"]);
const AGENT_IDS = [
  "itixo-builder",
  "itixo-docs-updater",
  "itixo-github-issues",
  "itixo-investigator",
  "itixo-planner",
  "itixo-reviewer",
  SECURITY_REVIEWER_AGENT_ID,
  "itixo-tester",
];

function validateCatalog(catalog) {
  const codex = catalog?.providers?.codex;
  if (!codex || typeof codex !== "object") fail("Model catalog has no Codex provider.");
  for (const key of ["models", "efforts", "aliases", "cheapModels", "cheapEfforts", "cheapEffortOverrides", "effortsByModel"]) {
    if (!codex[key] || typeof codex[key] !== "object") fail(`Model catalog has invalid Codex '${key}'.`);
  }
  for (const tier of ["cheap", "mid", "security"]) {
    if (typeof codex.models[tier] !== "string" || typeof codex.efforts[tier] !== "string") {
      fail(`Model catalog has invalid Codex '${tier}' default.`);
    }
  }
  const models = Object.keys(codex.effortsByModel);
  if (models.length === 0 || models.some((model) => !Array.isArray(codex.effortsByModel[model]) || codex.effortsByModel[model].length === 0)) {
    fail("Model catalog has invalid Codex model efforts.");
  }
  for (const model of [...Object.values(codex.models), ...Object.values(codex.aliases), ...Object.values(codex.cheapModels), ...Object.keys(codex.cheapEffortOverrides)]) {
    if (!models.includes(model)) fail(`Model catalog references unknown Codex model '${model}'.`);
  }
  if (!Array.isArray(codex.cheapEfforts) || codex.cheapEfforts.length === 0) fail("Model catalog has invalid cheap efforts.");
  if (Object.entries(codex.models).some(([tier, model]) => !codex.effortsByModel[model].includes(codex.efforts[tier]))
    || Object.entries(codex.cheapEffortOverrides).some(([model, effort]) => !codex.effortsByModel[model].includes(effort))) {
    fail("Model catalog has invalid cheap default effort.");
  }
  return codex;
}

function defaultCheapEffort(model) {
  return CODEX_CATALOG.cheapEffortOverrides[model] || CODEX_CATALOG.efforts.cheap;
}

function defaultTemplateSettings(agentId) {
  if (CHEAP_AGENT_IDS.has(agentId)) return { model: CODEX_CATALOG.models.cheap, effort: CODEX_CATALOG.efforts.cheap };
  if (agentId === SECURITY_REVIEWER_AGENT_ID) return { model: CODEX_CATALOG.models.security, effort: CODEX_CATALOG.efforts.security };
  return { model: CODEX_CATALOG.models.mid, effort: CODEX_CATALOG.efforts.mid };
}

function fail(message) {
  throw new Error(message);
}

function usage() {
  const cheapModels = Object.keys(CHEAP_MODEL_ALIASES).join("|");
  const agentModels = Object.keys(AGENT_MODEL_ALIASES).join("|");
  const agentEfforts = [...AGENT_EFFORTS].join("|");
  return [
    "Usage:",
    `  node install-agents.js --scope personal [--cheap-model ${cheapModels}] [--cheap-effort ${[...CHEAP_EFFORTS].join("|")}] [--agent-model <id>=<${agentModels}>]... [--agent-effort <id>=<${agentEfforts}>]...`,
    `  node install-agents.js --scope project --project-root <path> [--cheap-model ${cheapModels}] [--cheap-effort ${[...CHEAP_EFFORTS].join("|")}] [--agent-model <id>=<${agentModels}>]... [--agent-effort <id>=<${agentEfforts}>]...`,
  ].join("\n");
}

function parseAgentAssignments(argument, assignments, allowedValues, fieldLabel) {
  const parsed = {};
  for (const assignment of assignments) {
    const match = assignment.match(/^([^=]+)=([^=]+)$/);
    if (!match) {
      fail(`Malformed agent ${fieldLabel} override '${assignment}'. Expected '<itixo-agent-id>=<value>'.`);
    }
    const [, agentId, value] = match;
    if (!AGENT_IDS.includes(agentId)) {
      fail(`Unknown agent ID '${agentId}' for '${argument}'.`);
    }
    if (!allowedValues.has(value)) {
      fail(`Invalid agent ${fieldLabel} '${value}' for '${agentId}'.`);
    }
    if (Object.hasOwn(parsed, agentId)) {
      fail(`Duplicate agent ${fieldLabel} override for '${agentId}'.`);
    }
    parsed[agentId] = value;
  }
  return parsed;
}

function parseArguments(argv) {
  const values = {};
  const repeatableValues = {
    "--agent-model": [],
    "--agent-effort": [],
  };
  const allowedArguments = new Set([
    "--scope",
    "--project-root",
    "--cheap-model",
    "--cheap-effort",
    ...REPEATABLE_ARGUMENTS,
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      return { help: true };
    }
    if (!allowedArguments.has(argument)) {
      fail(`Unknown argument '${argument}'.\n${usage()}`);
    }
    if (!REPEATABLE_ARGUMENTS.has(argument) && Object.hasOwn(values, argument)) {
      fail(`Argument '${argument}' may be specified only once.\n${usage()}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`Argument '${argument}' requires a value.\n${usage()}`);
    }
    if (REPEATABLE_ARGUMENTS.has(argument)) {
      repeatableValues[argument].push(value);
    } else {
      values[argument] = value;
    }
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
    fail(`Invalid cheap model. Use ${[...CHEAP_MODELS].map((model) => `'${model}'`).join(", ")}.`);
  }
  if (values["--cheap-effort"] && !CHEAP_EFFORTS.has(values["--cheap-effort"])) {
    fail(`Invalid cheap effort. Use ${[...CHEAP_EFFORTS].map((effort) => `'${effort}'`).join(", ")}.`);
  }

  const cheapModel = CHEAP_MODEL_ALIASES[values["--cheap-model"] || CODEX_CATALOG.models.cheap] || CODEX_CATALOG.models.cheap;
  const agentModels = parseAgentAssignments(
    "--agent-model",
    repeatableValues["--agent-model"],
    new Set(Object.keys(AGENT_MODEL_ALIASES)),
    "model",
  );
  const agentEfforts = parseAgentAssignments(
    "--agent-effort",
    repeatableValues["--agent-effort"],
    AGENT_EFFORTS,
    "effort",
  );

  return {
    scope: values["--scope"],
    projectRoot: values["--project-root"],
    cheapModel,
    cheapEffort: values["--cheap-effort"] || defaultCheapEffort(cheapModel),
    agentModels,
    agentEfforts,
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

function setTomlField(content, field, value) {
  const fieldPattern = new RegExp(`^${field} = .+\\n`, "m");
  if (fieldPattern.test(content)) {
    return value === null ? content.replace(fieldPattern, "") : content.replace(fieldPattern, `${field} = "${value}"\n`);
  }
  if (value === null) return content;

  const anchorPattern = field === "model_reasoning_effort" && /^model = .+$/m.test(content)
    ? /^model = .+$/m
    : /^description = .+$/m;
  if (!anchorPattern.test(content)) fail(`Cannot add '${field}' to custom agent template.`);
  return content.replace(anchorPattern, (anchor) => `${anchor}\n${field} = "${value}"`);
}

function readTemplate(agentId, cheapModel, cheapEffort, agentModel, agentEffort) {
  const selectedCheapModel = cheapModel || CODEX_CATALOG.models.cheap;
  const selectedCheapEffort = cheapEffort || defaultCheapEffort(selectedCheapModel);
  const templatePath = path.join(TEMPLATE_DIRECTORY, `${agentId}.toml`);
  let content;
  try {
    content = fs.readFileSync(templatePath, "utf8");
  } catch (error) {
    fail(`Cannot read template '${templatePath}': ${error.message}`);
  }
  validateTemplate(agentId, templatePath, content);

  if (CHEAP_AGENT_IDS.has(agentId)) {
    content = setTomlField(content, "model", selectedCheapModel);
    content = setTomlField(content, "model_reasoning_effort", selectedCheapEffort);
  }
  if (agentModel !== undefined) content = setTomlField(content, "model", AGENT_MODEL_ALIASES[agentModel]);
  if (agentEffort !== undefined) {
    content = setTomlField(content, "model_reasoning_effort", agentEffort === "none" ? null : agentEffort);
  }
  const model = content.match(/^model = "([^"]+)"$/m)?.[1];
  const effort = content.match(/^model_reasoning_effort = "([^"]+)"$/m)?.[1];
  if (model && effort && GPT_6_EFFORTS[model] && !GPT_6_EFFORTS[model].has(effort)) {
    fail(`Unsupported reasoning effort '${effort}' for model '${model}' on '${agentId}'.`);
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

  const { model: expectedModel, effort: expectedEffort } = defaultTemplateSettings(agentId);
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
  const cheapModel = CHEAP_MODEL_ALIASES[options.cheapModel] || options.cheapModel || CODEX_CATALOG.models.cheap;
  const cheapEffort = options.cheapEffort || defaultCheapEffort(cheapModel);
  const agentModels = options.agentModels || {};
  const agentEfforts = options.agentEfforts || {};
  const destination = resolveDestination(options);
  const templates = AGENT_IDS.map((agentId) => [
    agentId,
    readTemplate(agentId, cheapModel, cheapEffort, agentModels[agentId], agentEfforts[agentId]),
  ]);
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
  const summary = [
    `summary installed=${installed}`,
    `skipped=${skipped}`,
    `scope=${options.scope}`,
    `cheap-model=${cheapModel}`,
    `cheap-effort=${cheapEffort}`,
  ];
  const modelSummary = Object.keys(agentModels).sort().map((agentId) => `${agentId}:${agentModels[agentId]}`);
  const effortSummary = Object.keys(agentEfforts).sort().map((agentId) => `${agentId}:${agentEfforts[agentId]}`);
  if (modelSummary.length > 0) summary.push(`agent-models=${modelSummary.join(",")}`);
  if (effortSummary.length > 0) summary.push(`agent-efforts=${effortSummary.join(",")}`);
  console.log(summary.join(" "));
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
