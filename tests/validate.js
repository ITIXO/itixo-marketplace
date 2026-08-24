#!/usr/bin/env node
// Static structure tests for itixo-marketplace.
// Run: node tests/validate.js
// No dependencies. Exit 0 = pass, 1 = fail.

const fs = require("fs");
const path = require("path");
const { collectStaleness, expectedOutputs, readBaseAgents } = require("../scripts/generate-agents.js");

const ROOT = path.join(__dirname, "..");
let failures = 0;

function fail(msg) {
  failures++;
  console.error(`FAIL: ${msg}`);
}

function ok(msg) {
  console.log(`ok: ${msg}`);
}

function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
}

function readJson(rel) {
  try {
    return JSON.parse(readFile(rel));
  } catch (e) {
    fail(`${rel}: invalid JSON (${e.message})`);
    return null;
  }
}

// --- Expected orchestration model tiers (must match base/rules/agents.md) ---
const TIERS = {
  "itixo-investigator": "cheap",
  "itixo-planner": "orchestrator",
  "itixo-builder": "mid",
  "itixo-github-issues": "mid",
  "itixo-tester": "mid",
  "itixo-reviewer": "mid",
  "itixo-security-reviewer": "security",
  "itixo-docs-updater": "cheap",
};
const CLAUDE_MODEL = { cheap: "haiku", mid: "sonnet", security: "opus", orchestrator: "inherit" };
const CODEX_MODEL = {
  cheap: "gpt-5.6-luna",
  mid: "gpt-5.6-terra",
  security: "gpt-5.6-sol",
  orchestrator: "user-selected",
};
const COPILOT_MODEL = { cheap: "claude-haiku-4.5", mid: "claude-sonnet-5", security: "claude-opus-5" }; // orchestrator inherits (no model field)
const ORCHESTRATION_PLUGINS = ["itixo-claude", "itixo-codex", "itixo-copilot"];

// --- 1. Claude marketplace registrations have valid Claude manifests ---
const marketplace = readJson(".claude-plugin/marketplace.json");
if (marketplace) {
  const registered = (marketplace.plugins || []).map((p) => p.name);
  if (new Set(registered).size !== registered.length) {
    fail("marketplace.json: duplicate plugin registrations");
  }
  for (const entry of marketplace.plugins || []) {
    const src = entry.source || "";
    const dir = path.join(ROOT, src);
    if (!fs.existsSync(dir)) {
      fail(`marketplace.json: plugin '${entry.name}' source '${src}' does not exist`);
    }
    if (!entry.description) {
      fail(`marketplace.json: plugin '${entry.name}' has no description`);
    }
    const manifestRel = path.join(src, ".claude-plugin/plugin.json");
    const manifest = readJson(manifestRel);
    if (!manifest) continue;
    for (const field of ["name", "description", "version"]) {
      if (!manifest[field]) fail(`${manifestRel}: missing '${field}'`);
    }
    if (manifest.name !== entry.name) {
      fail(`${manifestRel}: name '${manifest.name}' does not match marketplace entry '${entry.name}'`);
    }
  }
  if (failures === 0) ok("Claude marketplace registrations and manifests valid");
}

// --- 3. base, Claude, and Codex template role sets match exactly ---
const expectedRoles = Object.keys(TIERS).sort();
const agentRoles = (directory) => fs
  .readdirSync(path.join(ROOT, directory), { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
  .map((entry) => entry.name.slice(0, -3))
  .sort();
const copilotAgentRoles = (directory) => fs
  .readdirSync(path.join(ROOT, directory), { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".agent.md"))
  .map((entry) => entry.name.slice(0, -".agent.md".length))
  .sort();
const baseAgents = agentRoles("base/agents");
const codexTemplateRoles = fs
  .readdirSync(path.join(ROOT, "plugins/itixo-codex/templates/agents"), { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".toml"))
  .map((entry) => entry.name.slice(0, -5))
  .sort();

for (const [label, actualRoles] of [
  ["base/agents", baseAgents],
  ["plugins/itixo-claude/agents", agentRoles("plugins/itixo-claude/agents")],
  ["plugins/itixo-codex/templates/agents", codexTemplateRoles],
  ["plugins/itixo-copilot/agents", copilotAgentRoles("plugins/itixo-copilot/agents")],
]) {
  if (JSON.stringify(actualRoles) !== JSON.stringify(expectedRoles)) {
    fail(`${label}: role set ${JSON.stringify(actualRoles)}, expected ${JSON.stringify(expectedRoles)}`);
  }
}
if (failures === 0) ok("base and provider agent role sets match exactly");

// --- 3a. generated provider files are byte-for-byte current ---
try {
  const outputs = expectedOutputs(readBaseAgents(ROOT), ROOT);
  const staleness = collectStaleness(outputs, ROOT);
  for (const [kind, paths] of Object.entries(staleness)) {
    for (const relativePath of paths) fail(`generated agent output ${kind}: ${relativePath}`);
  }
  if (outputs.length !== expectedRoles.length * ORCHESTRATION_PLUGINS.length) {
    fail(`generated agent output count ${outputs.length}, expected ${expectedRoles.length * ORCHESTRATION_PLUGINS.length}`);
  }
} catch (error) {
  fail(`generated agent validation failed (${error.message})`);
}
if (failures === 0) ok("generated provider agent files are byte-for-byte current");

// --- 3aa. canonical structured contracts survive provider generation ---
const CONTRACT_HEADINGS = [
  "Role",
  "Required input",
  "Responsibilities",
  "Workflow",
  "Tool boundaries",
  "Refusals and escalation",
  "Output contract",
];
const MODEL_FOOTER = "- Last line of every final report: `model: <exact model identifier you run on, from your environment context>`. If identifier is not available, write `model: unknown`.";

function providerBody(text, provider) {
  if (provider === "claude") {
    return text.replace(/^---\n[\s\S]*?\n---\n(?:\n)?/, "").replace(/\n<!-- Generated[\s\S]*?-->\n?$/, "");
  }
  return text.replace(/^#[\s\S]*?developer_instructions = \"\"\"\n/, "").replace(/\n\"\"\"\n?$/, "");
}

for (const agent of expectedRoles) {
  for (const [provider, extension] of [["claude", "md"], ["codex", "toml"]]) {
    const rel = provider === "claude"
      ? `plugins/itixo-claude/agents/${agent}.${extension}`
      : `plugins/itixo-codex/templates/agents/${agent}.${extension}`;
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) continue;
    const body = providerBody(fs.readFileSync(p, "utf8"), provider);
    let previousHeading = -1;
    for (const heading of CONTRACT_HEADINGS) {
      const position = body.indexOf(`## ${heading}`);
      if (position <= previousHeading) fail(`${rel}: '${heading}' heading missing or out of order`);
      previousHeading = position;
    }
    if (body.trimEnd().split("\n").at(-1) !== MODEL_FOOTER) {
      fail(`${rel}: model footer must be final nonblank instruction line`);
    }
  }
}
if (failures === 0) ok("generated provider bodies retain structured contracts");

// --- 3b. dirigent skills exist and reference canonical Itixo IDs ---
for (const plugin of ORCHESTRATION_PLUGINS) {
  const rel = `plugins/${plugin}/skills/dirigent/SKILL.md`;
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    fail(`${rel} missing`);
    continue;
  }
  const text = readFile(rel);
  if (!/^---\nname: dirigent\n/m.test(text)) fail(`${rel}: invalid dirigent frontmatter`);
  if (!text.includes("../../rules/agents.md")) fail(`${rel}: must load delegation rules`);
  for (const agent of expectedRoles) {
    if (!text.includes(agent)) fail(`${rel}: missing canonical agent ID '${agent}'`);
  }
}
if (failures === 0) ok("dirigent skills exist and reference canonical agent IDs");

// --- 4. itixo-claude: frontmatter model matches tier ---
for (const agent of Object.keys(TIERS)) {
  const rel = `plugins/itixo-claude/agents/${agent}.md`;
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) continue; // already reported
  const text = readFile(rel);
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) {
    fail(`${rel}: missing frontmatter`);
    continue;
  }
  const model = (fm[1].match(/^model:\s*(\S+)/m) || [])[1];
  const expected = CLAUDE_MODEL[TIERS[agent]];
  if (model !== expected) {
    fail(`${rel}: model '${model}', expected '${expected}' (tier ${TIERS[agent]})`);
  }
  for (const field of ["name", "description", "tools"]) {
    if (!new RegExp(`^${field}:`, "m").test(fm[1])) fail(`${rel}: frontmatter missing '${field}'`);
  }
}
if (failures === 0) ok("itixo-claude agent models match tiers");

// --- 4b. itixo-copilot: .agent.md frontmatter model matches tier ---
for (const agent of Object.keys(TIERS)) {
  const rel = `plugins/itixo-copilot/agents/${agent}.agent.md`;
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) continue;
  const text = readFile(rel);
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) {
    fail(`${rel}: missing frontmatter`);
    continue;
  }
  // model field uses quoted value: model: "claude-sonnet-5"
  const model = (fm[1].match(/^model:\s*"?([^"\n]+)"?/m) || [])[1];
  if (TIERS[agent] === "orchestrator") {
    if (model) fail(`${rel}: orchestrator must not set model (inherits default)`);
  } else {
    const expected = COPILOT_MODEL[TIERS[agent]];
    if (model !== expected) fail(`${rel}: model '${model}', expected '${expected}' (tier ${TIERS[agent]})`);
    if (TIERS[agent] === "security" && /^model_reasoning_effort:/m.test(fm[1])) {
      fail(`${rel}: security reviewer must not set a Copilot effort field`);
    }
  }
  for (const field of ["description", "tools"]) {
    if (!new RegExp(`^${field}:`, "m").test(fm[1])) fail(`${rel}: frontmatter missing '${field}'`);
  }
}
if (failures === 0) ok("itixo-copilot agent models match tiers");

// --- 5. itixo-codex: custom TOML templates model tiers ---
for (const agent of Object.keys(TIERS)) {
  const rel = `plugins/itixo-codex/templates/agents/${agent}.toml`;
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) continue;
  const text = readFile(rel);
  if (!text.startsWith("# Itixo-managed custom agent. Do not edit.\n")) {
    fail(`${rel}: missing Itixo-managed marker`);
  }
  if (!text.includes(`# Generated from base/agents/${agent}.md by scripts/generate-agents.js.`)) {
    fail(`${rel}: missing generated-source marker`);
  }
  for (const field of ["name", "description", "developer_instructions"]) {
    if (!new RegExp(`^${field} =`, "m").test(text)) fail(`${rel}: missing '${field}'`);
  }
  const model = (text.match(/^model = "([^"]+)"$/m) || [])[1];
  const effort = (text.match(/^model_reasoning_effort = "([^"]+)"$/m) || [])[1];
  if (agent === "itixo-planner") {
    if (model || effort) fail(`${rel}: planner must inherit model and effort`);
  } else {
    const expected = CODEX_MODEL[TIERS[agent]];
    const expectedEffort = TIERS[agent] === "cheap" ? "high" : TIERS[agent] === "security" ? "max" : "medium";
    if (model !== expected) fail(`${rel}: model '${model}', expected '${expected}'`);
    if (effort !== expectedEffort) fail(`${rel}: effort '${effort}', expected '${expectedEffort}'`);
  }
}
const obsoleteCodexAgentsDirectory = path.join(ROOT, "plugins/itixo-codex/agents");
if (fs.existsSync(obsoleteCodexAgentsDirectory)) {
  const obsolete = fs.readdirSync(obsoleteCodexAgentsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"));
  if (obsolete.length > 0) fail("plugins/itixo-codex/agents: obsolete Markdown agent files remain");
}
if (failures === 0) ok("itixo-codex custom agent templates match tiers");

// --- 5a. Codex custom-agent installer is packaged with its explicit setup skill ---
const installerScriptRel = "plugins/itixo-codex/scripts/install-agents.js";
const installerSkillRel = "plugins/itixo-codex/skills/install-agents/SKILL.md";
for (const rel of [installerScriptRel, installerSkillRel]) {
  if (!fs.existsSync(path.join(ROOT, rel))) fail(`${rel} missing`);
}
if (fs.existsSync(path.join(ROOT, installerScriptRel))) {
  const installerScript = readFile(installerScriptRel);
  if (!installerScript.startsWith("#!/usr/bin/env node\n")) fail(`${installerScriptRel}: missing Node shebang`);
  if (!installerScript.includes("--scope") || !installerScript.includes("--project-root")) {
    fail(`${installerScriptRel}: missing explicit scope arguments`);
  }
}
if (fs.existsSync(path.join(ROOT, installerSkillRel))) {
  const installerSkill = readFile(installerSkillRel);
  if (!/^---\nname: install-agents\n/m.test(installerSkill)) {
    fail(`${installerSkillRel}: invalid install-agents frontmatter`);
  }
  if (!installerSkill.includes("${PLUGIN_ROOT}/scripts/install-agents.js")) {
    fail(`${installerSkillRel}: must invoke plugin installer script`);
  }
}
if (failures === 0) ok("itixo-codex custom-agent installer packaged");

// --- 5b. Codex orchestration references canonical agent IDs ---
const codexAgentsRel = "plugins/itixo-codex/AGENTS.md";
const codexAgentsPath = path.join(ROOT, codexAgentsRel);
if (fs.existsSync(codexAgentsPath)) {
  const codexAgents = readFile(codexAgentsRel);
  for (const agent of expectedRoles) {
    if (!codexAgents.includes(agent)) fail(`${codexAgentsRel}: missing canonical agent ID '${agent}'`);
  }
}
if (failures === 0) ok("itixo-codex references canonical agent IDs");

// --- 6. rules files exist ---
for (const rel of [
  "base/rules/agents.md",
  "plugins/itixo-claude/rules/agents.md",
  "plugins/itixo-codex/rules/agents.md",
  "plugins/itixo-codex/AGENTS.md",
  "plugins/itixo-copilot/rules/agents.md",
]) {
  if (!fs.existsSync(path.join(ROOT, rel))) fail(`${rel} missing`);
}
if (failures === 0) ok("rules files present");

// --- 7. Codex-native manifests ---
const codexMarketplace = readJson(".agents/plugins/marketplace.json");
if (codexMarketplace) {
  for (const entry of codexMarketplace.plugins || []) {
    const src = entry.source && entry.source.path;
    if (!src) {
      fail(`.agents/plugins/marketplace.json: plugin '${entry.name}' missing source.path`);
      continue;
    }
    if (!fs.existsSync(path.join(ROOT, src))) {
      fail(`.agents/plugins/marketplace.json: plugin '${entry.name}' path '${src}' does not exist`);
    }
    const codexManifestRel = path.join(src, ".codex-plugin/plugin.json");
    const codexManifest = readJson(codexManifestRel);
    if (!codexManifest) continue;
    if (codexManifest.name !== entry.name) {
      fail(`${src}/.codex-plugin/plugin.json: name mismatch with marketplace entry '${entry.name}'`);
    }
  }
  const codexEntry = (codexMarketplace.plugins || []).find((p) => p.name === "itixo");
  if (!codexEntry) {
    fail(".agents/plugins/marketplace.json: itixo not registered");
  } else {
    const manifestRel = path.join(codexEntry.source?.path || "", ".codex-plugin/plugin.json");
    const manifest = readJson(manifestRel);
    if (!manifest) {
      fail(`.agents/plugins/marketplace.json: itixo missing native manifest '${manifestRel}'`);
    } else if (manifest.name !== "itixo") {
      fail(`${manifestRel}: expected native manifest name 'itixo', got '${manifest.name}'`);
    }
  }
}
if (failures === 0) ok("Codex-native manifests valid and consistent");

// --- 7b. Copilot-native marketplace ---
const copilotMarketplace = readJson(".github/plugin/marketplace.json");
if (copilotMarketplace) {
  const registered = (copilotMarketplace.plugins || []).map((p) => p.name);
  if (new Set(registered).size !== registered.length) {
    fail(".github/plugin/marketplace.json: duplicate plugin registrations");
  }
  for (const entry of copilotMarketplace.plugins || []) {
    const src = entry.source || "";
    const dir = path.join(ROOT, src);
    if (!fs.existsSync(dir)) {
      fail(`.github/plugin/marketplace.json: plugin '${entry.name}' source '${src}' does not exist`);
    }
    if (!entry.description) {
      fail(`.github/plugin/marketplace.json: plugin '${entry.name}' has no description`);
    }
    const manifestRel = path.join(src, "plugin.json");
    const manifest = readJson(manifestRel);
    if (!manifest) continue;
    for (const field of ["name", "description", "version"]) {
      if (!manifest[field]) fail(`${manifestRel}: missing '${field}'`);
    }
    if (manifest.name !== entry.name) {
      fail(`${manifestRel}: name '${manifest.name}' does not match marketplace entry '${entry.name}'`);
    }
  }
  const copilotEntry = (copilotMarketplace.plugins || []).find((p) => p.name === "itixo");
  if (!copilotEntry) {
    fail(".github/plugin/marketplace.json: itixo not registered");
  }
}
if (failures === 0) ok("Copilot-native manifests valid and consistent");

// --- 8. itixo-codex: default runtime-model reporting hook ---
const claudePluginManifestRel = "plugins/itixo-claude/.claude-plugin/plugin.json";
const codexPluginManifestRel = "plugins/itixo-codex/.codex-plugin/plugin.json";
const claudePluginManifest = readJson(claudePluginManifestRel);
const codexPluginManifest = readJson(codexPluginManifestRel);
const copilotPluginManifestRel = "plugins/itixo-copilot/plugin.json";
const copilotPluginManifest = readJson(copilotPluginManifestRel);
const sharedManifestFields = ["author", "homepage", "repository", "skills", "keywords"];

// --- 7c. public marketplace labels and provider versions stay intentional ---
const publicMarketplaceLabels = [
  [".claude-plugin/marketplace.json", marketplace],
  [".agents/plugins/marketplace.json", codexMarketplace],
  [".github/plugin/marketplace.json", copilotMarketplace],
];
for (const [rel, manifest] of publicMarketplaceLabels) {
  if (manifest?.name !== "itixo") fail(`${rel}: public marketplace name must be 'itixo'`);
}
if (codexMarketplace?.interface?.displayName !== "itixo") {
  fail(".agents/plugins/marketplace.json: public marketplace displayName must be 'itixo'");
}
for (const [rel, manifest, technicalName, version] of [
  [claudePluginManifestRel, claudePluginManifest, "itixo", "0.8.2"],
  [codexPluginManifestRel, codexPluginManifest, "itixo", "0.7.2"],
  [copilotPluginManifestRel, copilotPluginManifest, "itixo", "0.7.1"],
]) {
  if (!manifest) continue;
  if (manifest.name !== technicalName) fail(`${rel}: technical name must remain '${technicalName}'`);
  if (manifest.version !== version) fail(`${rel}: version must be '${version}'`);
}
if (copilotPluginManifest && Object.hasOwn(copilotPluginManifest, "displayName")) {
  fail(`${copilotPluginManifestRel}: must not invent a Copilot displayName field`);
}
if (failures === 0) ok("public labels, technical IDs, and provider versions valid");

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isNonEmptyStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === "string" && entry.length > 0);
}

function validateMarketplacePngIcon(manifestRel, field, assetRel) {
  const icon = fs.readFileSync(path.join(ROOT, assetRel));
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (icon.length < 24 || !icon.subarray(0, 8).equals(pngSignature)) {
    fail(`${manifestRel}: interface ${field} must reference a PNG file`);
    return;
  }
  if (icon.readUInt32BE(8) !== 13 || icon.toString("ascii", 12, 16) !== "IHDR") {
    fail(`${manifestRel}: interface ${field} PNG must contain an IHDR header`);
    return;
  }
  const width = icon.readUInt32BE(16);
  const height = icon.readUInt32BE(20);
  if (width !== height || width < 128 || width > 2048) {
    fail(`${manifestRel}: interface ${field} PNG must be square and 128-2048px, got ${width}x${height}`);
  }
}

if (claudePluginManifest && codexPluginManifest) {
  for (const field of sharedManifestFields) {
    if (!Object.hasOwn(claudePluginManifest, field)) fail(`${claudePluginManifestRel}: missing shared '${field}'`);
    if (!Object.hasOwn(codexPluginManifest, field)) fail(`${codexPluginManifestRel}: missing shared '${field}'`);
    if (field !== "keywords" && JSON.stringify(claudePluginManifest[field]) !== JSON.stringify(codexPluginManifest[field])) {
      fail(`plugin manifests: shared '${field}' must match exactly`);
    }
  }

  const author = claudePluginManifest.author;
  if (!author || typeof author !== "object" || !isHttpsUrl(author.url)) {
    fail("plugin manifests: shared author.url must be an HTTPS URL");
  }
  if (!isHttpsUrl(claudePluginManifest.homepage)) fail("plugin manifests: shared homepage must be an HTTPS URL");
  if (typeof claudePluginManifest.repository !== "string" || claudePluginManifest.repository.length === 0) {
    fail("plugin manifests: shared repository must be a non-empty string");
  }
  if (typeof claudePluginManifest.skills !== "string" || claudePluginManifest.skills.length === 0) {
    fail("plugin manifests: shared skills must be a non-empty string path");
  }
  for (const [manifestRel, manifest] of [[claudePluginManifestRel, claudePluginManifest], [codexPluginManifestRel, codexPluginManifest]]) {
    if (!isNonEmptyStringArray(manifest.keywords)) fail(`${manifestRel}: keywords must be a non-empty string array`);
  }
  for (const [manifestRel, manifest, providerTag] of [
    [claudePluginManifestRel, claudePluginManifest, "claude"],
    [codexPluginManifestRel, codexPluginManifest, "codex"],
  ]) {
    for (const keyword of [providerTag, "orchestration", "agents", "skills", "developer-tools", "dirigent"]) {
      if (!manifest.keywords?.includes(keyword)) fail(`${manifestRel}: keywords must include '${keyword}'`);
    }
  }

  if (claudePluginManifest.displayName !== "itixo") {
    fail(`${claudePluginManifestRel}: displayName must be 'itixo'`);
  }
  if (Object.hasOwn(claudePluginManifest, "interface")) {
    fail(`${claudePluginManifestRel}: must not define Codex interface metadata`);
  }

  const codexInterface = codexPluginManifest.interface;
  if (!codexInterface || typeof codexInterface !== "object" || Array.isArray(codexInterface)) {
    fail(`${codexPluginManifestRel}: missing interface metadata`);
  } else {
    for (const field of ["displayName", "shortDescription", "longDescription", "developerName", "category", "capabilities", "websiteURL", "defaultPrompt", "composerIcon", "logo"]) {
      if (!Object.hasOwn(codexInterface, field)) fail(`${codexPluginManifestRel}: interface missing '${field}'`);
    }
    for (const field of ["displayName", "shortDescription", "longDescription"]) {
      if (typeof codexInterface[field] !== "string" || codexInterface[field].trim().length === 0) {
        fail(`${codexPluginManifestRel}: interface '${field}' must be a non-empty string`);
      }
    }
    if (codexInterface.displayName !== "itixo") {
      fail(`${codexPluginManifestRel}: interface displayName must be 'itixo'`);
    }
    if (codexInterface.developerName !== "Itixo") fail(`${codexPluginManifestRel}: interface developerName must be 'Itixo'`);
    if (codexInterface.category !== "Developer Tools") fail(`${codexPluginManifestRel}: interface category must be 'Developer Tools'`);
    if (JSON.stringify(codexInterface.capabilities) !== JSON.stringify(["Read", "Write"])) {
      fail(`${codexPluginManifestRel}: interface capabilities must be exactly Read/Write`);
    }
    if (!isHttpsUrl(codexInterface.websiteURL)) fail(`${codexPluginManifestRel}: interface websiteURL must be an HTTPS URL`);
    if (!Array.isArray(codexInterface.defaultPrompt) || codexInterface.defaultPrompt.length < 1 || codexInterface.defaultPrompt.length > 3 ||
      codexInterface.defaultPrompt.some((prompt) => typeof prompt !== "string" || prompt.length === 0 || prompt.length > 128)) {
      fail(`${codexPluginManifestRel}: interface defaultPrompt must contain 1-3 non-empty prompts of at most 128 characters`);
    }
    for (const field of ["composerIcon", "logo"]) {
      if (codexInterface[field] !== "./assets/icon.png") {
        fail(`${codexPluginManifestRel}: interface ${field} must be './assets/icon.png'`);
      }
      const assetRel = path.join("plugins/itixo-codex", codexInterface[field] || "");
      if (!fs.existsSync(path.join(ROOT, assetRel))) {
        fail(`${codexPluginManifestRel}: interface ${field} references missing '${assetRel}'`);
      } else {
        validateMarketplacePngIcon(codexPluginManifestRel, field, assetRel);
      }
    }
  }
}
if (failures === 0) ok("provider manifest metadata valid and consistent");

// --- 9. itixo-codex: default runtime-model reporting hook ---
if (codexPluginManifest && Object.hasOwn(codexPluginManifest, "hooks")) {
  fail(`${codexPluginManifestRel}: hooks must be auto-discovered from hooks/hooks.json`);
}

const runtimeModelHookRel = "plugins/itixo-codex/hooks/hooks.json";
const runtimeModelScriptRel = "plugins/itixo-codex/scripts/runtime-model.js";
const runtimeModelHook = readJson(runtimeModelHookRel);
if (!fs.existsSync(path.join(ROOT, runtimeModelScriptRel))) {
  fail(`${runtimeModelScriptRel} missing`);
} else {
  const runtimeModelScript = readFile(runtimeModelScriptRel);
  if (!runtimeModelScript.includes('hookEventName: "SubagentStart"')) {
    fail(`${runtimeModelScriptRel}: missing SubagentStart hook output`);
  }
}
const hookCommands = runtimeModelHook?.hooks?.SubagentStart?.flatMap((entry) => entry.hooks || []) || [];
const expectedRuntimeModelCommand = 'node "${PLUGIN_ROOT}/scripts/runtime-model.js"';
if (!hookCommands.some((hook) => hook.type === "command" && hook.command === expectedRuntimeModelCommand)) {
  fail(`${runtimeModelHookRel}: missing SubagentStart runtime-model command`);
}
if (runtimeModelHook?.hooks?.SubagentStart?.some((entry) => entry.matcher !== "*")) {
  fail(`${runtimeModelHookRel}: SubagentStart hook must apply to all agents`);
}
if (failures === 0) ok("itixo-codex runtime-model hook configured");

// --- result ---
if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nAll checks passed");
