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
const TIER_NAMES = ["cheap", "mid", "security"];
const CODEX_CATALOG = validateCatalog(MODEL_CATALOG);
const MODEL_ALIASES = CODEX_CATALOG.aliases;
const PINNED_ALIASES = CODEX_CATALOG.pinnedAliases;
const CONCRETE_MODELS = new Set(Object.keys(CODEX_CATALOG.effortsByModel));
const TIER_MODEL_ALIASES = new Set(Object.keys(MODEL_ALIASES));
const MODEL_SELECTORS = new Set([...TIER_MODEL_ALIASES, ...Object.keys(PINNED_ALIASES), ...CONCRETE_MODELS]);
const CHEAP_EFFORTS = new Set(CODEX_CATALOG.cheapEfforts);
const AGENT_EFFORTS = new Set(["none", ...new Set(Object.values(CODEX_CATALOG.effortsByModel).flat())]);
const GPT_6_EFFORTS = Object.freeze(Object.fromEntries(
  Object.entries(CODEX_CATALOG.effortsByModel).map(([model, efforts]) => [model, new Set(efforts)]),
));
const REPEATABLE_ARGUMENTS = new Set(["--agent-model", "--agent-effort", "--tier-model", "--model-version"]);
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
  for (const key of ["models", "efforts", "aliases", "pinnedAliases", "cheapEfforts", "cheapEffortOverrides", "effortsByModel"]) {
    if (!codex[key] || typeof codex[key] !== "object") fail(`Model catalog has invalid Codex '${key}'.`);
  }
  for (const tier of TIER_NAMES) {
    if (typeof codex.models[tier] !== "string" || typeof codex.efforts[tier] !== "string" || !Object.hasOwn(codex.aliases, codex.models[tier])) {
      fail(`Model catalog has invalid Codex '${tier}' default.`);
    }
  }
  const models = Object.keys(codex.effortsByModel);
  if (models.length === 0 || models.some((model) => !Array.isArray(codex.effortsByModel[model]) || codex.effortsByModel[model].length === 0)) {
    fail("Model catalog has invalid Codex model efforts.");
  }
  for (const [alias, definition] of Object.entries(codex.aliases)) {
    if (!definition || typeof definition !== "object" || typeof definition.default !== "string"
      || !Array.isArray(definition.versions) || definition.versions.length === 0
      || !definition.versions.includes(definition.default)) {
      fail(`Model catalog has invalid Codex alias '${alias}'.`);
    }
  }
  for (const model of [
    ...Object.values(codex.aliases).flatMap((definition) => definition.versions),
    ...Object.values(codex.pinnedAliases),
    ...Object.keys(codex.cheapEffortOverrides),
  ]) {
    if (!models.includes(model)) fail(`Model catalog references unknown Codex model '${model}'.`);
  }
  if (!Array.isArray(codex.cheapEfforts) || codex.cheapEfforts.length === 0) fail("Model catalog has invalid cheap efforts.");
  if (Object.entries(codex.models).some(([tier, alias]) => !codex.effortsByModel[codex.aliases[alias].default].includes(codex.efforts[tier]))
    || Object.entries(codex.cheapEffortOverrides).some(([model, effort]) => !codex.effortsByModel[model].includes(effort))) {
    fail("Model catalog has invalid cheap default effort.");
  }
  return codex;
}

function resolveModel(selector, modelVersions = {}) {
  if (CONCRETE_MODELS.has(selector)) return selector;
  if (Object.hasOwn(PINNED_ALIASES, selector)) return PINNED_ALIASES[selector];
  const alias = MODEL_ALIASES[selector];
  if (!alias) fail(`Unknown Codex model selector '${selector}'.`);
  return modelVersions[selector] || alias.default;
}

function resolveTierModels(tierModels, modelVersions) {
  return Object.fromEntries(TIER_NAMES.map((tier) => [tier, resolveModel(tierModels[tier], modelVersions)]));
}

function defaultCheapEffort(model) {
  return CODEX_CATALOG.cheapEffortOverrides[model] || CODEX_CATALOG.efforts.cheap;
}

function defaultTemplateSettings(agentId) {
  const models = resolveTierModels(CODEX_CATALOG.models, {});
  if (CHEAP_AGENT_IDS.has(agentId)) return { model: models.cheap, effort: CODEX_CATALOG.efforts.cheap };
  if (agentId === SECURITY_REVIEWER_AGENT_ID) return { model: models.security, effort: CODEX_CATALOG.efforts.security };
  return { model: models.mid, effort: CODEX_CATALOG.efforts.mid };
}

function fail(message) {
  throw new Error(message);
}

function usage() {
  const cheapModels = [...MODEL_SELECTORS].join("|");
  const aliases = [...TIER_MODEL_ALIASES].join("|");
  const agentModels = [...MODEL_SELECTORS].join("|");
  const agentEfforts = [...AGENT_EFFORTS].join("|");
  return [
    "Usage:",
    `  node install-agents.js --scope personal [--tier-model <cheap|mid|security>=<${aliases}>]... [--model-version <${aliases}>=<model>]... [--cheap-model ${cheapModels}] [--cheap-effort ${[...CHEAP_EFFORTS].join("|")}] [--agent-model <id>=<${agentModels}>]... [--agent-effort <id>=<${agentEfforts}>]...`,
    `  node install-agents.js --scope project --project-root <path> [--tier-model <cheap|mid|security>=<${aliases}>]... [--model-version <${aliases}>=<model>]... [--cheap-model ${cheapModels}] [--cheap-effort ${[...CHEAP_EFFORTS].join("|")}] [--agent-model <id>=<${agentModels}>]... [--agent-effort <id>=<${agentEfforts}>]...`,
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

function parseTierAssignments(assignments) {
  const parsed = {};
  for (const assignment of assignments) {
    const match = assignment.match(/^(cheap|mid|security)=([^=]+)$/);
    if (!match) fail(`Malformed tier model override '${assignment}'. Expected '<cheap|mid|security>=<alias>'.`);
    const [, tier, alias] = match;
    if (!TIER_MODEL_ALIASES.has(alias)) fail(`Invalid tier model alias '${alias}' for '${tier}'.`);
    if (Object.hasOwn(parsed, tier)) fail(`Duplicate tier model override for '${tier}'.`);
    parsed[tier] = alias;
  }
  return parsed;
}

function parseModelVersions(assignments) {
  const parsed = {};
  for (const assignment of assignments) {
    const match = assignment.match(/^([^=]+)=([^=]+)$/);
    if (!match) fail(`Malformed model version override '${assignment}'. Expected '<alias>=<model>'.`);
    const [, alias, model] = match;
    const definition = MODEL_ALIASES[alias];
    if (!definition) fail(`Unknown model alias '${alias}' for '--model-version'.`);
    if (!definition.versions.includes(model)) fail(`Invalid model version '${model}' for alias '${alias}'.`);
    if (Object.hasOwn(parsed, alias)) fail(`Duplicate model version override for '${alias}'.`);
    parsed[alias] = model;
  }
  return parsed;
}

function parseArguments(argv) {
  const values = {};
  const repeatableValues = {
    "--agent-model": [],
    "--agent-effort": [],
    "--tier-model": [],
    "--model-version": [],
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
  if (values["--cheap-model"] && !MODEL_SELECTORS.has(values["--cheap-model"])) {
    fail(`Invalid cheap model. Use ${[...MODEL_SELECTORS].map((model) => `'${model}'`).join(", ")}.`);
  }
  if (values["--cheap-effort"] && !CHEAP_EFFORTS.has(values["--cheap-effort"])) {
    fail(`Invalid cheap effort. Use ${[...CHEAP_EFFORTS].map((effort) => `'${effort}'`).join(", ")}.`);
  }

  const tierOverrides = parseTierAssignments(repeatableValues["--tier-model"]);
  if (values["--cheap-model"] && tierOverrides.cheap) {
    fail("Arguments '--cheap-model' and '--tier-model cheap=...' cannot be used together.");
  }
  const modelVersions = parseModelVersions(repeatableValues["--model-version"]);
  const tierModels = { ...CODEX_CATALOG.models, ...tierOverrides };
  if (values["--cheap-model"]) tierModels.cheap = values["--cheap-model"];
  const resolvedTierModels = resolveTierModels(tierModels, modelVersions);
  const agentModels = parseAgentAssignments(
    "--agent-model",
    repeatableValues["--agent-model"],
    MODEL_SELECTORS,
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
    cheapModel: resolvedTierModels.cheap,
    cheapModelSelector: values["--cheap-model"],
    cheapEffort: values["--cheap-effort"] || defaultCheapEffort(resolvedTierModels.cheap),
    tierModels,
    resolvedTierModels,
    modelVersions,
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

function agentTier(agentId) {
  if (CHEAP_AGENT_IDS.has(agentId)) return "cheap";
  if (agentId === SECURITY_REVIEWER_AGENT_ID) return "security";
  return agentId === "itixo-planner" ? null : "mid";
}

function readTemplate(agentId, tierSettings, agentModel, agentEffort) {
  const templatePath = path.join(TEMPLATE_DIRECTORY, `${agentId}.toml`);
  let content;
  try {
    content = fs.readFileSync(templatePath, "utf8");
  } catch (error) {
    fail(`Cannot read template '${templatePath}': ${error.message}`);
  }
  validateTemplate(agentId, templatePath, content);

  const tier = agentTier(agentId);
  if (tier) {
    content = setTomlField(content, "model", tierSettings.models[tier]);
    content = setTomlField(content, "model_reasoning_effort", tierSettings.efforts[tier]);
  }
  if (agentModel !== undefined) content = setTomlField(content, "model", agentModel);
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
  const tierModels = options.tierModels || {
    ...CODEX_CATALOG.models,
    ...(options.cheapModel ? { cheap: options.cheapModel } : {}),
  };
  const resolvedTierModels = options.resolvedTierModels || resolveTierModels(tierModels, options.modelVersions || {});
  const cheapModel = resolvedTierModels.cheap;
  const cheapEffort = options.cheapEffort || defaultCheapEffort(cheapModel);
  const tierEfforts = { ...CODEX_CATALOG.efforts, cheap: cheapEffort };
  const agentModels = options.agentModels || {};
  const agentEfforts = options.agentEfforts || {};
  const destination = resolveDestination(options);
  const templates = AGENT_IDS.map((agentId) => [
    agentId,
    readTemplate(
      agentId,
      { models: resolvedTierModels, efforts: tierEfforts },
      agentModels[agentId] === undefined ? undefined : resolveModel(agentModels[agentId], options.modelVersions || {}),
      agentEfforts[agentId],
    ),
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
    `tiers=${TIER_NAMES.map((tier) => `${tier}:${tierModels[tier]}:${resolvedTierModels[tier]}`).join(",")}`,
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
