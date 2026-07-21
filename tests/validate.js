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

function readJson(rel) {
  const p = path.join(ROOT, rel);
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
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
  "itixo-docs-updater": "cheap",
};
const CLAUDE_MODEL = { cheap: "haiku", mid: "sonnet", orchestrator: "inherit" };
const CODEX_MODEL = {
  cheap: "gpt-5.6-luna",
  mid: "gpt-5.6-terra",
  orchestrator: "user-selected",
};
const ORCHESTRATION_PLUGINS = ["itixo-claude", "itixo-codex"];

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

// --- 3b. provider dispatch uses canonical Itixo IDs ---
const dirigentContents = new Map();
for (const plugin of ORCHESTRATION_PLUGINS) {
  const rel = `plugins/${plugin}/skills/dirigent/SKILL.md`;
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    fail(`${rel} missing`);
    continue;
  }
  const text = fs.readFileSync(p, "utf8");
  if (!/^---\nname: dirigent\n/m.test(text)) fail(`${rel}: invalid dirigent frontmatter`);
  if (!text.includes("../../rules/agents.md")) fail(`${rel}: must load delegation rules`);
  for (const agent of expectedRoles) {
    if (!text.includes(agent)) fail(`${rel}: missing canonical agent ID '${agent}'`);
  }
  dirigentContents.set(plugin, text);
}
const codexDirigent = dirigentContents.get("itixo-codex") || "";
if (!codexDirigent.includes("installed custom TOML agent")) {
  fail("plugins/itixo-codex/skills/dirigent/SKILL.md: must invoke installed custom TOML agents");
}
if (!codexDirigent.includes("itixo-codex:install-agents")) {
  fail("plugins/itixo-codex/skills/dirigent/SKILL.md: must require installer when custom agent is unavailable");
}
if (codexDirigent.includes("load the matching role file")) {
  fail("plugins/itixo-codex/skills/dirigent/SKILL.md: must not retain Markdown role dispatch");
}
if (!codexDirigent.includes("substitute a generic agent")) {
  fail("plugins/itixo-codex/skills/dirigent/SKILL.md: must forbid generic-agent fallback");
}
const claudeDirigent = dirigentContents.get("itixo-claude") || "";
if (!claudeDirigent.includes("native Claude plugin agent")) {
  fail("plugins/itixo-claude/skills/dirigent/SKILL.md: must retain native Claude dispatch");
}
if (failures === 0) ok("dirigent skills use provider-specific canonical dispatch");

// --- 3c. GitHub issue classification safeguards stay synchronized ---
const githubIssuesAgentRel = "base/agents/itixo-github-issues.md";
const githubIssuesAgentPath = path.join(ROOT, githubIssuesAgentRel);
const githubIssueClassificationChecks = [
  [
    "must prefer native IssueTypes when available",
    /\b(?:when|with)\s+native\s+(?:github\s+)?issuetypes?\b[\s\S]{0,180}\b(?:use\s+them\s+for\s+classification|classif(?:y|ies))\b/i,
  ],
  [
    "must classify root Feature and direct children Task",
    /\b(?:root|multi-workstream\s+root)\b[\s\S]{0,120}(?:`?\bfeature\b`?)[\s\S]{0,180}\bdirect\s+(?:sub-issues?|children)\b[\s\S]{0,120}(?:`?\btask\b`?)/i,
  ],
  [
    "must allow child Feature only when split into executable children",
    /\b(?:large\s+direct\s+(?:sub-issue|child)|direct\s+child)\b[\s\S]{0,120}(?:`?\bfeature\b`?)[\s\S]{0,160}\bonly\s+when\b[\s\S]{0,160}\bsplit\b[\s\S]{0,120}\bexecutable\s+child(?:ren|\s+issues)?\b/i,
  ],
  [
    "must limit hierarchy to Feature -> Feature -> Task",
    /\bat\s+most\s+two\s+parent-child\s+edges\b[\s\S]{0,100}\bfeature\s*->\s*feature\s*->\s*task\b/i,
  ],
  [
    "must limit fallback to personal repositories without native IssueTypes",
    /\bonly\s+when\s+native\s+(?:github\s+)?issuetypes?\s+are\s+unavailable\s+in\s+a\s+personal\s+repository\b[\s\S]{0,140}\blowercase\s+(?:`?\bfeature\b`?)\s+and\s+(?:`?\btask\b`?)\s+labels\b/i,
  ],
  ["must create only missing fallback labels", /\bcreat(?:e|es|ing)\s+only\s+missing\s+fallback\s+labels\b/i],
  [
    "must apply and read back fallback labels for every parent and child",
    /\b(?:appl(?:y|ies)\s+and\s+read(?:s)?\s+them\s+back\s+on\s+every\s+parent\s+and\s+child|appl(?:y|ies)\s+and\s+read[\s\S]{0,80}\brelevant\s+fallback\s+label\b[\s\S]{0,80}\broot\b[\s\S]{0,80}\beach\s+direct\s+child|apply[\s\S]{0,120}(?:the\s+)?parent\s+and\s+every\s+child[\s\S]{0,120}read[\s\S]{0,40}back)\b/i,
  ],
  [
    "must require type, fallback-label, and hierarchy evidence in output",
    /\b(?:type\/label\/depth\s+evidence|type\s+readback\s+evidence[\s\S]{0,240}label\s+creation\/assignment\s+readback\s+evidence[\s\S]{0,240}hierarchy\/depth\s+evidence)\b/i,
  ],
];

function checkGithubIssueClassification(text, rel) {
  for (const [message, pattern] of githubIssueClassificationChecks) {
    if (!pattern.test(text)) fail(`${rel}: ${message}`);
  }
}

if (!fs.existsSync(githubIssuesAgentPath)) {
  fail(`${githubIssuesAgentRel} missing`);
} else {
  const text = fs.readFileSync(githubIssuesAgentPath, "utf8");
  checkGithubIssueClassification(text, githubIssuesAgentRel);
  if (!/\broot\b[\s\S]{0,180}(?:`?\bfeature\b`?)[\s\S]{0,180}\bread\s+it\s+back\b/i.test(text)) {
    fail(`${githubIssuesAgentRel}: root Feature must be read back`);
  }
  if (!/\bdirect\s+sub-issue\b[\s\S]{0,120}(?:`?\btask\b`?)[\s\S]{0,120}\bread\s+it\s+back\b/i.test(text)) {
    fail(`${githubIssuesAgentRel}: direct Task must be read back`);
  }
  if (!/\bnested\s+executable\s+child(?:ren|\s+issues)?\b[\s\S]{0,160}\bactual\s+issuetype\s+(?:`?\btask\b`?)[\s\S]{0,120}\bread\s+it\s+back\b[\s\S]{0,180}\bterminal\b[\s\S]{0,180}\bno\s+deeper\s+children\b/i.test(text)) {
    fail(`${githubIssuesAgentRel}: native nested Tasks must set/read back IssueType and be terminal`);
  }
  if (!/\bdirect\s+child\s+is\s+(?:a\s+)?(?:`?\bfeature\b`?)[\s\S]{0,160}\bapply\b[\s\S]{0,80}\blowercase\s+(?:`?\btask\b`?)\s+label\b[\s\S]{0,120}\bnested\s+executable\s+child\b[\s\S]{0,120}\bread\s+it\s+back\b[\s\S]{0,180}\bterminal\b[\s\S]{0,180}\bno\s+deeper\s+children\b/i.test(text)) {
    fail(`${githubIssuesAgentRel}: fallback nested Tasks must apply/read back task label and be terminal`);
  }
  if (!/\bsole\s+exception\s+to\s+never\s+creating\s+labels\b[\s\S]{0,180}\boutside\b[\s\S]{0,120}\bexisting\s+labels\b/i.test(text)) {
    fail(`${githubIssuesAgentRel}: must forbid label creation outside fallback exception`);
  }
}
if (failures === 0) ok("canonical github-issues agent preserves IssueType and fallback-label safeguards");

// --- 3d. Dirigent skills delegate GitHub issue work using provider contracts ---
for (const [plugin, text] of dirigentContents) {
  const rel = `plugins/${plugin}/skills/dirigent/SKILL.md`;
  if (!/\bgithub\s+issue\b[\s\S]{0,80}\bassessment\b[\s\S]{0,80}\bstructuring\b[\s\S]{0,80}\bcreation\b[\s\S]{0,160}\bdelegate\b[\s\S]{0,160}\bexactly\s+one\s+`?itixo-github-issues`?\s+subagent\b/i.test(text)) {
    fail(`${rel}: must delegate GitHub issue assessment, structuring, and creation to exactly one itixo-github-issues subagent`);
  }
  if (plugin === "itixo-claude") {
    if (!/\bload\s+(?:the\s+)?matching\s+`?\.\.\/\.\.\/agents\/itixo-github-issues\.md`?\s+role\s+instructions\b/i.test(text)) {
      fail(`${rel}: must load itixo-github-issues role instructions`);
    }
    if (!/\bselect\s+(?:the\s+)?mid-tier\s+provider\s+model\s+required\s+by\s+`?rules\/agents\.md`?\b/i.test(text)) {
      fail(`${rel}: must select mid-tier itixo-github-issues model from delegation rules`);
    }
  } else {
    if (!/\binvoke\s+the\s+installed\s+custom\s+toml\s+agent\s+by\s+(?:that\s+)?canonical\s+id\b/i.test(text)) {
      fail(`${rel}: must invoke the installed custom TOML issue agent by canonical ID`);
    }
    if (!/\btoml\s+owns\s+role\s+instructions\s*,\s*model\s*,\s*and\s+reasoning\s+effort\b/i.test(text)) {
      fail(`${rel}: installed TOML must own issue-agent instructions, model, and effort`);
    }
    if (/\bload\s+(?:the\s+)?matching\s+`?\.\.\/\.\.\/agents\/itixo-github-issues\.md`?\s+role\s+instructions\b/i.test(text)) {
      fail(`${rel}: must not require unavailable Markdown issue-agent instructions`);
    }
  }
  if (!/\binclude\s+requested\s+outcome\s*,\s*target\s+repository\s+context\s*,\s*constraints\s*,\s*and\s+expected\s+output\s+in\s+(?:its\s+)?task\s+prompt\b/i.test(text)) {
    fail(`${rel}: itixo-github-issues prompt must include outcome, repository context, constraints, and expected output`);
  }
  if (!/\borchestrator\s+never\s+creates?\s+an?\s+issue\s+directly\b/i.test(text)) {
    fail(`${rel}: must prohibit direct orchestrator issue creation`);
  }
}
if (failures === 0) ok("dirigent delegates GitHub issue work with provider-specific contracts");

// --- 3e. delegation rules assign GitHub issue work to the correct agent ---
const githubIssueRuleFiles = [
  {
    rel: "base/rules/agents.md",
    model: /\bselect\s+(?:the\s+)?provider\s+model\s+in\s+(?:the\s+)?`?mid`?\s+tier\b/i,
  },
  {
    rel: "plugins/itixo-claude/rules/agents.md",
    model: /\bselect\s+`?sonnet`?[\s\S]{0,80}\b`?mid`?\b/i,
  },
  {
    rel: "plugins/itixo-codex/rules/agents.md",
    codexToml: true,
  },
];
for (const { rel, model, codexToml } of githubIssueRuleFiles) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    fail(`${rel} missing`);
    continue;
  }
  const text = fs.readFileSync(p, "utf8");
  if (!/\bdelegate\s+all\s+(?:github\s+)?issue\s+assessment\s*,\s*structuring\s*,\s*and\s+creation\s+work\s+to\s+exactly\s+one\s+`?itixo-github-issues`?\s+agent\b/i.test(text)) {
    fail(`${rel}: must assign all GitHub issue assessment, structuring, and creation to exactly one itixo-github-issues agent`);
  }
  if (!/\bdo\s+not\s+split\s+checks\s+and\s+creation\s+between\s+agents\b/i.test(text)) {
    fail(`${rel}: must keep GitHub issue checks and creation with one agent`);
  }
  if (codexToml) {
    if (!/\binvoke\s+the\s+installed\s+custom\s+toml\s+agent\s+by\s+canonical\s+`?itixo-github-issues`?\s+id\b/i.test(text)) {
      fail(`${rel}: must invoke installed custom TOML issue agent by canonical ID`);
    }
    if (!/\btoml\s+owns\s+role\s+instructions\s*,\s*model\s*,\s*and\s+reasoning\s+effort\b/i.test(text)) {
      fail(`${rel}: installed TOML must own issue-agent instructions, model, and effort`);
    }
    if (/\bload\s+(?:the\s+)?matching\s+`?agents\/itixo-github-issues\.md`?\s+role\s+instructions\b/i.test(text)) {
      fail(`${rel}: must not require unavailable Markdown issue-agent instructions`);
    }
  } else {
    if (!/\bload\s+(?:the\s+)?matching\s+`?agents\/itixo-github-issues\.md`?\s+role\s+instructions\b/i.test(text)) {
      fail(`${rel}: must load itixo-github-issues role instructions before delegation`);
    }
    if (!model.test(text)) {
      fail(`${rel}: must select its mid-tier itixo-github-issues model`);
    }
  }
  if (!/\bprompt\s+that\s+agent\s+with\s+requested\s+outcome\s*,\s*(?:target\s+)?repository\s+and\s+owner\s+context\s*,\s*constraints\s*,\s*(?:and\s+)?expected\s+output\b/i.test(text)) {
    fail(`${rel}: itixo-github-issues prompt must include outcome, repository and owner context, constraints, and expected output`);
  }
  if (!/\borchestrator\s+must\s+not\s+assess\s*,\s*structure\s*,\s*or\s+create\s+issues\s+directly\b/i.test(text)) {
    fail(`${rel}: must prohibit direct orchestrator assessment, structuring, and creation`);
  }
  checkGithubIssueClassification(text, rel);
}
if (failures === 0) ok("delegation rules keep GitHub issue ownership and classification semantics synchronized");

// --- 4. itixo-claude: frontmatter model matches tier ---
for (const agent of Object.keys(TIERS)) {
  const rel = `plugins/itixo-claude/agents/${agent}.md`;
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) continue; // already reported
  const text = fs.readFileSync(p, "utf8");
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

// --- 5. itixo-codex: custom TOML templates model tiers ---
for (const agent of Object.keys(TIERS)) {
  const rel = `plugins/itixo-codex/templates/agents/${agent}.toml`;
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) continue;
  const text = fs.readFileSync(p, "utf8");
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
    const expectedEffort = TIERS[agent] === "cheap" ? "low" : "medium";
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
  const installerScript = fs.readFileSync(path.join(ROOT, installerScriptRel), "utf8");
  if (!installerScript.startsWith("#!/usr/bin/env node\n")) fail(`${installerScriptRel}: missing Node shebang`);
  if (!installerScript.includes("--scope") || !installerScript.includes("--project-root")) {
    fail(`${installerScriptRel}: missing explicit scope arguments`);
  }
}
if (fs.existsSync(path.join(ROOT, installerSkillRel))) {
  const installerSkill = fs.readFileSync(path.join(ROOT, installerSkillRel), "utf8");
  if (!/^---\nname: install-agents\n/m.test(installerSkill)) {
    fail(`${installerSkillRel}: invalid install-agents frontmatter`);
  }
  if (!installerSkill.includes("${PLUGIN_ROOT}/scripts/install-agents.js")) {
    fail(`${installerSkillRel}: must invoke plugin installer script`);
  }
}
if (failures === 0) ok("itixo-codex custom-agent installer packaged");

// --- 5b. Codex orchestration dispatches only to installed TOML agents ---
const codexAgentsRel = "plugins/itixo-codex/AGENTS.md";
const codexAgentsPath = path.join(ROOT, codexAgentsRel);
if (fs.existsSync(codexAgentsPath)) {
  const codexAgents = fs.readFileSync(codexAgentsPath, "utf8");
  for (const agent of expectedRoles) {
    if (!codexAgents.includes(agent)) fail(`${codexAgentsRel}: missing canonical agent ID '${agent}'`);
  }
  for (const required of [
    "installed custom TOML agent",
    "itixo-codex:install-agents",
    "model or reasoning-effort override",
    "substitute a generic agent",
  ]) {
    if (!codexAgents.includes(required)) fail(`${codexAgentsRel}: missing custom-agent dispatch requirement '${required}'`);
  }
  if (codexAgents.includes("definitions in `agents/`") || codexAgents.includes("load the matching role file")) {
    fail(`${codexAgentsRel}: must not retain removed Markdown role dispatch`);
  }
}
if (failures === 0) ok("itixo-codex dispatch requires installed custom agents");

// --- 6. rules files exist ---
for (const rel of [
  "base/rules/agents.md",
  "plugins/itixo-claude/rules/agents.md",
  "plugins/itixo-codex/rules/agents.md",
  "plugins/itixo-codex/AGENTS.md",
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
  const codexEntry = (codexMarketplace.plugins || []).find((p) => p.name === "itixo-codex");
  if (!codexEntry) {
    fail(".agents/plugins/marketplace.json: itixo-codex not registered");
  } else {
    const manifestRel = path.join(codexEntry.source?.path || "", ".codex-plugin/plugin.json");
    const manifest = readJson(manifestRel);
    if (!manifest) {
      fail(`.agents/plugins/marketplace.json: itixo-codex missing native manifest '${manifestRel}'`);
    } else if (manifest.name !== "itixo-codex") {
      fail(`${manifestRel}: expected native manifest name 'itixo-codex', got '${manifest.name}'`);
    }
  }
}
if (failures === 0) ok("Codex-native manifests valid and consistent");

// --- 8. itixo-codex: default runtime-model reporting hook ---
const codexPluginManifestRel = "plugins/itixo-codex/.codex-plugin/plugin.json";
const codexPluginManifest = readJson(codexPluginManifestRel);
if (codexPluginManifest && Object.hasOwn(codexPluginManifest, "hooks")) {
  fail(`${codexPluginManifestRel}: hooks must be auto-discovered from hooks/hooks.json`);
}

const runtimeModelHookRel = "plugins/itixo-codex/hooks/hooks.json";
const runtimeModelScriptRel = "plugins/itixo-codex/scripts/runtime-model.js";
const runtimeModelHook = readJson(runtimeModelHookRel);
if (!fs.existsSync(path.join(ROOT, runtimeModelScriptRel))) {
  fail(`${runtimeModelScriptRel} missing`);
} else {
  const runtimeModelScript = fs.readFileSync(path.join(ROOT, runtimeModelScriptRel), "utf8");
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
