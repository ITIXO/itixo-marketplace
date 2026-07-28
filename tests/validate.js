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
  "itixo-docs-updater": "cheap",
};
const CLAUDE_MODEL = { cheap: "haiku", mid: "sonnet", orchestrator: "inherit" };
const CODEX_MODEL = {
  cheap: "gpt-5.6-luna",
  mid: "gpt-5.6-terra",
  orchestrator: "user-selected",
};
const COPILOT_MODEL = { cheap: "claude-haiku-4.5", mid: "claude-sonnet-4.6" }; // orchestrator inherits (no model field)
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

// --- 3b. provider dispatch uses canonical Itixo IDs ---
const dirigentContents = new Map();
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
const copilotDirigent = dirigentContents.get("itixo-copilot") || "";
if (!copilotDirigent.includes("native Copilot plugin agent")) {
  fail("plugins/itixo-copilot/skills/dirigent/SKILL.md: must retain native Copilot dispatch");
}
if (failures === 0) ok("dirigent skills use provider-specific canonical dispatch");

// --- 3ba. parallel-worker contract stays explicit in every rule and skill copy ---
const parallelContractFiles = [
  "base/rules/agents.md",
  "plugins/itixo-claude/rules/agents.md",
  "plugins/itixo-codex/rules/agents.md",
  "plugins/itixo-claude/skills/dirigent/SKILL.md",
  "plugins/itixo-codex/skills/dirigent/SKILL.md",
];
const parallelContractChecks = [
  ["decompose upfront", /\bdecompose\s+upfront\b/i],
  ["require three safe units", /\bat\s+least\s+three\b[\s\S]{0,100}\bsafe\s+independent\s+executable\s+units\b/i],
  ["launch three direct workers before awaiting", /\b(?:launch|issue)\s+exactly\s+three\s+direct[\s\S]{0,100}\bbefore\s+awaiting\s+any\s+result\b/i],
  ["exclude orchestrator from worker count", /\borchestrator\s+is\s+not\s+a\s+worker\b/i],
  ["keep rolling window full", /\brolling\s+window\b[\s\S]{0,180}\b(?:as\s+(?:a\s+)?(?:worker\s+)?slot\s+opens|as\s+a\s+slot\s+opens)\b/i],
  ["forbid serial waits with ready work", /\bnever\s+wait\s+serially\s+while\s+ready\s+independent\s+work\s+exists\b/i],
  ["forbid redundant slot filling", /\bnever\s+invent\s+redundant\s+work\s+or\s+violate\s+dependencies\s+or\s+role\s+ownership\s+to\s+fill\s+(?:a\s+)?slot\b/i],
  ["report only non-runtime shortfalls", /\bfewer\s+than\s+three[\s\S]{0,240}\bdependency\s*,\s*ambiguity\s*,\s*or\s+agent\s+availability\b[\s\S]{0,160}\breport\s+(?:those\s+)?non-runtime\s+reasons\b/i],
  ["not report runtime-cap reductions", /\bruntime\s+capacity[\s\S]{0,100}\bdo\s+not\s+report\s+runtime-cap\s+reductions\s+or\s+shortfalls\s+to\s+(?:the\s+)?user\b/i],
];
const legacyParallelContractChecks = [
  ["four-worker directives", /\b(?:launch|issue|dispatch|run|use|allow|permit|start|spawn|require|when)\b[\s\S]{0,80}\bfour\b[\s\S]{0,80}\b(?:direct\s+)?(?:workers?|agents?|calls?)\b|\bmaximum\s+parallel\s+workers?\s*:\s*four\b/i],
  ["Codex agents.max_threads >= 5", /`?agents\.max_threads\s*>=\s*5`?/i],
  ["runtime-cap shortfall reporting", /(?<!do not )\breport\s+(?:the\s+)?runtime(?:-|\s)cap(?:\s+(?:reductions?|shortfalls?))?/i],
];
for (const rel of parallelContractFiles) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    fail(`${rel} missing`);
    continue;
  }
  const text = fs.readFileSync(p, "utf8");
  for (const [message, pattern] of parallelContractChecks) {
    if (!pattern.test(text)) fail(`${rel}: parallel-worker contract must ${message}`);
  }
  for (const [legacy, pattern] of legacyParallelContractChecks) {
    if (pattern.test(text)) fail(`${rel}: must not retain ${legacy}`);
  }
}
const providerParallelContracts = [
  {
    provider: "Claude",
    files: [
      "base/rules/agents.md",
      "plugins/itixo-claude/rules/agents.md",
      "plugins/itixo-claude/skills/dirigent/SKILL.md",
    ],
    checks: [
      ["use ordinary Agent subagents", /\bordinary\s+`?agent`?\s+subagents\b/i],
      ["issue up to three ordinary Agent calls together", /\b(?:issue\s+)?up\s+to\s+three\s+calls\s+together\b/i],
      ["forbid experimental Agent Teams", /\bdo\s+not\s+use\s+experimental\s+agent\s+teams\b/i],
    ],
  },
  {
    provider: "Codex",
    files: [
      "base/rules/agents.md",
      "plugins/itixo-codex/rules/agents.md",
      "plugins/itixo-codex/skills/dirigent/SKILL.md",
    ],
    checks: [
      ["require agents.max_threads >= 4", /`?agents\.max_threads\s*>=\s*4`?/i],
      ["recommend agents.max_depth = 1", /\brecommend\s+`?agents\.max_depth\s*=\s*1`?/i],
      ["state that skill cannot raise runtime cap", /\b(?:a|this)\s+skill\s+cannot\s+raise\s+a\s+runtime\s+cap\b/i],
    ],
  },
];
for (const { provider, files, checks } of providerParallelContracts) {
  for (const rel of files) {
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    for (const [message, pattern] of checks) {
      if (!pattern.test(text)) fail(`${rel}: ${provider} parallel-worker contract must ${message}`);
    }
  }
}
if (failures === 0) ok("parallel-worker contract synchronized across rules and dirigent skills");

// --- 3bb. write-work commits use the builder contract everywhere ---
const writeWorkContractFiles = [
  "base/rules/agents.md",
  "plugins/itixo-claude/rules/agents.md",
  "plugins/itixo-codex/rules/agents.md",
  "plugins/itixo-copilot/rules/agents.md",
  "plugins/itixo-claude/skills/dirigent/SKILL.md",
  "plugins/itixo-codex/skills/dirigent/SKILL.md",
  "plugins/itixo-copilot/skills/dirigent/SKILL.md",
];
const writeWorkCommitChecks = [
  ["cover every meaningful unit", /\bevery\s+meaningful\s+unit\s+of\s+write\s+work\b/i],
  ["read targets before editing", /\bread\s+each\s+target\s+before\s+editing\b/i],
  ["require the smallest authorized change", /\bsmallest\s+authorized\s+change\b/i],
  ["inspect scoped dependencies and diff", /\binspect\s+scoped\s+dependencies\b[\s\S]{0,160}\binspect\s+the\s+diff\b/i],
  ["run proportionate verification", /\brun\s+proportionate\s+verification\b/i],
  ["commit before returning", /\bcommit\s+before\s+returning\b/i],
  ["use caveman commit fallback", /\buse\s+`?caveman:caveman-commit`?\s*;\s*if\s+unavailable\s*,\s*use\s+a\s+terse\s+conventional\s+commit\s+message\b/i],
];
for (const rel of writeWorkContractFiles) {
  const text = readFile(rel);
  for (const [message, pattern] of writeWorkCommitChecks) {
    if (!pattern.test(text)) fail(`${rel}: write-work commit contract must ${message}`);
  }
}
if (failures === 0) ok("write-work commit contract synchronized across rules and dirigent skills");

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
  const text = readFile(githubIssuesAgentRel);
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
    if (!/\buser\s+explicitly\s+requested\s+a\s+model\s+and\/or\s+effort\s+override\s+for\s+this\s+invocation\b[\s\S]{0,120}\brelay\s+those\s+matching\s+fields\b[\s\S]{0,120}\botherwise\s+use\s+the\s+generated\s+sonnet\/mid\s+default\b/i.test(text)) {
      fail(`${rel}: must honor matching GitHub-issues overrides or use the generated Sonnet/mid default`);
    }
  } else if (plugin === "itixo-copilot") {
    if (!/\bload\s+(?:the\s+)?matching\s+`?\.\.\/\.\.\/agents\/itixo-github-issues\.agent\.md`?\s+role\s+instructions\b/i.test(text)) {
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
    model: /\bhonor\s+a\s+matching\s+explicit\s+per-invocation\s+model\s+and\/or\s+effort\s+override\b[\s\S]{0,120}\botherwise\s+use\s+the\s+`?mid`?-tier\s+sonnet\s+default\b/i,
  },
  {
    rel: "plugins/itixo-claude/rules/agents.md",
    model: /\bhonor\s+a\s+matching\s+explicit\s+per-invocation\s+model\s+and\/or\s+effort\s+override\b[\s\S]{0,120}\botherwise\s+select\s+`?sonnet`?\s*,\s*the\s+`?mid`?\s+model\b[\s\S]{0,120}\bgenerated\s+default\s+effort\b/i,
  },
  {
    rel: "plugins/itixo-codex/rules/agents.md",
    codexToml: true,
  },
  {
    rel: "plugins/itixo-copilot/rules/agents.md",
    model: /\bselect\s+`?claude-sonnet-4\.6`?[\s\S]{0,80}\b`?mid`?\b/i,
  },
];
for (const { rel, model, codexToml } of githubIssueRuleFiles) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    fail(`${rel} missing`);
    continue;
  }
  const text = readFile(rel);
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
    // support both .md (claude) and .agent.md (copilot) paths
    if (!/\bload\s+(?:the\s+)?matching\s+`?agents\/itixo-github-issues(?:\.agent)?\.md`?\s+role\s+instructions\b/i.test(text)) {
      fail(`${rel}: must load itixo-github-issues role instructions before delegation`);
    }
    if (!model.test(text)) {
      fail(`${rel}: must honor matching GitHub-issues overrides or use its prescribed Sonnet/mid default`);
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
  // model field uses quoted value: model: "claude-sonnet-4.6"
  const model = (fm[1].match(/^model:\s*"?([^"\n]+)"?/m) || [])[1];
  if (TIERS[agent] === "orchestrator") {
    if (model) fail(`${rel}: orchestrator must not set model (inherits default)`);
  } else {
    const expected = COPILOT_MODEL[TIERS[agent]];
    if (model !== expected) fail(`${rel}: model '${model}', expected '${expected}' (tier ${TIERS[agent]})`);
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
    const expectedEffort = TIERS[agent] === "cheap" ? "high" : "medium";
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

// --- 5b. Codex orchestration dispatches only to installed TOML agents ---
const codexAgentsRel = "plugins/itixo-codex/AGENTS.md";
const codexAgentsPath = path.join(ROOT, codexAgentsRel);
if (fs.existsSync(codexAgentsPath)) {
  const codexAgents = readFile(codexAgentsRel);
  for (const agent of expectedRoles) {
    if (!codexAgents.includes(agent)) fail(`${codexAgentsRel}: missing canonical agent ID '${agent}'`);
  }
  for (const required of [
    "installed custom TOML agent",
    "itixo-codex:install-agents",
    "per-agent override",
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
  const copilotEntry = (copilotMarketplace.plugins || []).find((p) => p.name === "itixo-copilot");
  if (!copilotEntry) {
    fail(".github/plugin/marketplace.json: itixo-copilot not registered");
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
  [claudePluginManifestRel, claudePluginManifest, "itixo-claude", "0.6.0"],
  [codexPluginManifestRel, codexPluginManifest, "itixo-codex", "0.6.0"],
  [copilotPluginManifestRel, copilotPluginManifest, "itixo-copilot", "0.6.0"],
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
