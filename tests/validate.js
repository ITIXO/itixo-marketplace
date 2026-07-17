#!/usr/bin/env node
// Static structure tests for itixo-marketplace.
// Run: node tests/validate.js
// No dependencies. Exit 0 = pass, 1 = fail.

const fs = require("fs");
const path = require("path");

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
  investigator: "cheap",
  planner: "orchestrator",
  builder: "mid",
  "github-issues": "mid",
  tester: "mid",
  reviewer: "mid",
  "docs-updater": "cheap",
};
const CLAUDE_MODEL = { cheap: "haiku", mid: "sonnet", orchestrator: "inherit" };
const CODEX_MODEL = {
  cheap: "gpt-5.6-luna",
  mid: "gpt-5.6-terra",
  orchestrator: "user-selected",
};
const ORCHESTRATION_PLUGINS = ["itixo-claude", "itixo-codex"];

// --- 1. marketplace.json valid + plugins registered both ways ---
const marketplace = readJson(".claude-plugin/marketplace.json");
if (marketplace) {
  const registered = (marketplace.plugins || []).map((p) => p.name);
  const onDisk = fs
    .readdirSync(path.join(ROOT, "plugins"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const name of onDisk) {
    if (!registered.includes(name)) {
      fail(`plugins/${name} exists on disk but is not registered in marketplace.json`);
    }
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
  }
  if (failures === 0) ok("marketplace.json valid, registration consistent");
}

// --- 2. every plugin has valid plugin.json with required fields ---
for (const dirent of fs.readdirSync(path.join(ROOT, "plugins"), { withFileTypes: true })) {
  if (!dirent.isDirectory()) continue;
  const rel = `plugins/${dirent.name}/.claude-plugin/plugin.json`;
  const manifest = readJson(rel);
  if (!manifest) continue;
  for (const field of ["name", "description", "version"]) {
    if (!manifest[field]) fail(`${rel}: missing '${field}'`);
  }
  if (manifest && manifest.name !== dirent.name) {
    fail(`${rel}: name '${manifest.name}' does not match folder '${dirent.name}'`);
  }
}
if (failures === 0) ok("all plugin.json manifests valid");

// --- 3. base agents present in both orchestration plugins ---
const baseAgents = fs
  .readdirSync(path.join(ROOT, "base/agents"))
  .filter((f) => f.endsWith(".md"))
  .map((f) => f.replace(/\.md$/, ""));

for (const agent of Object.keys(TIERS)) {
  if (!baseAgents.includes(agent)) fail(`base/agents/${agent}.md missing`);
}
for (const plugin of ORCHESTRATION_PLUGINS) {
  for (const agent of baseAgents) {
    const p = path.join(ROOT, "plugins", plugin, "agents", `${agent}.md`);
    if (!fs.existsSync(p)) fail(`plugins/${plugin}/agents/${agent}.md missing (exists in base)`);
  }
}
if (failures === 0) ok("base agents mirrored in both plugins");

// --- 3b. shared orchestration skill present and identical in both plugins ---
const dirigentPaths = ORCHESTRATION_PLUGINS.map(
  (plugin) => `plugins/${plugin}/skills/dirigent/SKILL.md`,
);
const dirigentContents = [];
for (const rel of dirigentPaths) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    fail(`${rel} missing`);
    continue;
  }
  const text = fs.readFileSync(p, "utf8");
  if (!/^---\nname: dirigent\n/m.test(text)) fail(`${rel}: invalid dirigent frontmatter`);
  if (!text.includes("../../rules/agents.md")) fail(`${rel}: must load delegation rules`);
  dirigentContents.push(text);
}
if (dirigentContents.length === dirigentPaths.length && dirigentContents[0] !== dirigentContents[1]) {
  fail("dirigent skill content differs between plugins");
}
if (failures === 0) ok("dirigent skill mirrored and loads delegation rules");

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

// --- 5. itixo-codex: header states expected model ---
for (const agent of Object.keys(TIERS)) {
  const rel = `plugins/itixo-codex/agents/${agent}.md`;
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) continue;
  const firstLine = fs.readFileSync(p, "utf8").split("\n")[0];
  const expected = CODEX_MODEL[TIERS[agent]];
  if (!firstLine.includes(expected)) {
    fail(`${rel}: first line must state model '${expected}', got: ${firstLine}`);
  }
}
if (failures === 0) ok("itixo-codex agent models match tiers");

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
    const codexManifest = readJson(path.join(src, ".codex-plugin/plugin.json"));
    if (codexManifest && codexManifest.name !== entry.name) {
      fail(`${src}/.codex-plugin/plugin.json: name mismatch with marketplace entry '${entry.name}'`);
    }
  }
  const codexNames = (codexMarketplace.plugins || []).map((p) => p.name);
  if (!codexNames.includes("itixo-codex")) {
    fail(".agents/plugins/marketplace.json: itixo-codex not registered");
  }
}
if (failures === 0) ok("Codex-native manifests valid and consistent");

// --- result ---
if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nAll checks passed");
