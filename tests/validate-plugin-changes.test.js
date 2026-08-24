"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const test = require("node:test");
const { PROVIDERS } = require("../scripts/providers");

const ROOT = path.join(__dirname, "..");
const CHECKER = path.join(ROOT, "scripts", "validate-plugin-changes.js");
const { gitBuffer } = require("../scripts/validate-plugin-changes.js");

function writeJson(root, relativePath, value) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function commit(root, message) {
  git(root, ["add", "--all"]);
  git(root, ["commit", "--quiet", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

function withRepository(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "itixo-plugin-policy-"));
  try {
    git(root, ["init", "--quiet"]);
    git(root, ["config", "user.name", "Policy Test"]);
    git(root, ["config", "user.email", "policy-test@example.test"]);
    return callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function plugin(name, version) {
  return { name, description: `${name} plugin`, version };
}

function marketplace(...entries) {
  return { name: "test-marketplace", plugins: entries };
}

function pluginDirectory(provider, name = "itixo") {
  return path.posix.join("plugins", provider, name);
}

function writeBaselinePlugin(root, provider = "claude", version = "1.0.0", name = "itixo") {
  writeBaselinePlugins(root, [[provider, version, name]]);
}

function writeBaselinePlugins(root, entries) {
  for (const [provider, version, name = "itixo"] of entries) {
    writeJson(root, `${pluginDirectory(provider, name)}/.claude-plugin/plugin.json`, plugin(name, version));
  }
  writeJson(root, ".claude-plugin/marketplace.json", marketplace(...entries.map(([provider, , name = "itixo"]) => ({
    name,
    source: `./${pluginDirectory(provider, name)}`,
    description: `${name} plugin`,
    category: "Developer Tools",
  }))));
}

// Builds a `### YYYY-MM-DD` date section with zero or more
// `#### MAJOR.MINOR.PATCH` version headings, each with an optional
// bullet-list body.
function dateBlock(date, versions = []) {
  const lines = [`### ${date}`, ""];
  for (const version of versions) {
    lines.push(`#### ${version.version}`);
    lines.push("");
    for (const bullet of version.body ?? []) lines.push(bullet);
    lines.push("");
  }
  return lines.join("\n");
}

function doc(...blocks) {
  return `${blocks.join("\n")}\n`;
}

// Baseline `claude/itixo` plugin bumped from `fromVersion` to `toVersion`;
// returns the base commit SHA for the bump.
function setupBumpedClaude(root, fromVersion = "1.0.0", toVersion = "1.0.1") {
  writeBaselinePlugin(root, "claude", fromVersion);
  const base = commit(root, "baseline");
  writeJson(root, "plugins/claude/itixo/.claude-plugin/plugin.json", plugin("itixo", toVersion));
  commit(root, "bump plugin");
  return base;
}

// Writes one `changelog.<provider>.md` file per provider into a temp
// directory and spawns the checker with `--changelog-dir <dir>`.
// `changelogs` maps provider -> file content; a provider key mapped to
// `null` omits that file entirely (to simulate a missing changelog).
// Providers not present in `changelogs` default to an empty file.
function runChecker(root, base, changelogs = {}) {
  const changelogDir = path.join(root, "changelogs");
  fs.mkdirSync(changelogDir, { recursive: true });
  for (const provider of PROVIDERS) {
    const content = Object.prototype.hasOwnProperty.call(changelogs, provider) ? changelogs[provider] : "";
    if (content === null) continue;
    fs.writeFileSync(path.join(changelogDir, `changelog.${provider}.md`), content);
  }
  const result = spawnSync(process.execPath, [CHECKER, "--base", base, "--changelog-dir", changelogDir], {
    cwd: root,
    encoding: "utf8",
  });
  return { ...result, output: `${result.stdout}${result.stderr}` };
}

test("policy checker passes when no plugin changed", () => withRepository((root) => {
  writeBaselinePlugin(root);
  const base = commit(root, "baseline");

  const result = runChecker(root, base);

  assert.equal(result.status, 0, result.output);
  assert.match(result.stdout, /Plugin release policy validation passed/);
}));

test("policy checker accepts all provider legacy relocations without release metadata", () => withRepository((root) => {
  for (const [provider, manifest] of [
    ["claude", ".claude-plugin/plugin.json"],
    ["codex", ".codex-plugin/plugin.json"],
    ["copilot", "plugin.json"],
  ]) {
    writeJson(root, `plugins/itixo-${provider}/${manifest}`, plugin("itixo", "1.0.0"));
  }
  writeJson(root, ".claude-plugin/marketplace.json", marketplace({
    name: "itixo",
    source: "./plugins/itixo-claude",
    description: "itixo plugin",
    category: "Developer Tools",
  }));
  writeJson(root, ".agents/plugins/marketplace.json", marketplace({
    name: "itixo",
    source: { source: "local", path: "./plugins/itixo-codex" },
    category: "Developer Tools",
  }));
  writeJson(root, ".github/plugin/marketplace.json", marketplace({
    name: "itixo",
    source: "./plugins/itixo-copilot",
    description: "itixo plugin",
  }));
  const base = commit(root, "baseline");
  for (const provider of ["claude", "codex", "copilot"]) {
    fs.mkdirSync(path.join(root, "plugins", provider), { recursive: true });
    fs.renameSync(path.join(root, `plugins/itixo-${provider}`), path.join(root, "plugins", provider, "itixo"));
  }
  writeJson(root, ".claude-plugin/marketplace.json", marketplace({
    name: "itixo",
    source: "./plugins/claude/itixo",
    description: "itixo plugin",
    category: "Developer Tools",
  }));
  writeJson(root, ".agents/plugins/marketplace.json", marketplace({
    name: "itixo",
    source: { source: "local", path: "./plugins/codex/itixo" },
    category: "Developer Tools",
  }));
  writeJson(root, ".github/plugin/marketplace.json", marketplace({
    name: "itixo",
    source: "./plugins/copilot/itixo",
    description: "itixo plugin",
  }));
  commit(root, "relocate plugin");

  const result = runChecker(root, base, "");

  assert.equal(result.status, 0, result.output);
}));

test("policy checker rejects copied legacy relocation when legacy root remains", () => withRepository((root) => {
  writeJson(root, "plugins/itixo-claude/.claude-plugin/plugin.json", plugin("itixo", "1.0.0"));
  writeJson(root, ".claude-plugin/marketplace.json", marketplace({
    name: "itixo",
    source: "./plugins/itixo-claude",
    description: "itixo plugin",
    category: "Developer Tools",
  }));
  const base = commit(root, "baseline");
  fs.mkdirSync(path.join(root, "plugins/claude"), { recursive: true });
  fs.cpSync(path.join(root, "plugins/itixo-claude"), path.join(root, "plugins/claude/itixo"), { recursive: true });
  fs.writeFileSync(path.join(root, "plugins/itixo-claude/README.md"), "legacy root changed\\n");
  writeJson(root, ".claude-plugin/marketplace.json", marketplace({
    name: "itixo",
    source: "./plugins/claude/itixo",
    description: "itixo plugin",
    category: "Developer Tools",
  }));
  commit(root, "copy plugin and retain legacy root");

  const result = runChecker(root, base, "");

  assert.equal(result.status, 1);
  assert.match(result.output, /version 1\.0\.0 must be greater than same-provider base version 1\.0\.0/);
}));

test("policy checker rejects Copilot relocation with marketplace metadata change", () => withRepository((root) => {
  writeJson(root, "plugins/itixo-copilot/plugin.json", plugin("itixo", "1.0.0"));
  writeJson(root, ".github/plugin/marketplace.json", marketplace({
    name: "itixo",
    source: "./plugins/itixo-copilot",
    description: "itixo plugin",
  }));
  const base = commit(root, "baseline");
  fs.mkdirSync(path.join(root, "plugins/copilot"), { recursive: true });
  fs.renameSync(path.join(root, "plugins/itixo-copilot"), path.join(root, "plugins/copilot/itixo"));
  writeJson(root, ".github/plugin/marketplace.json", marketplace({
    name: "itixo",
    source: "./plugins/copilot/itixo",
    description: "changed plugin",
  }));
  commit(root, "relocate and change category");

  const result = runChecker(root, base, "");

  assert.equal(result.status, 1);
  assert.match(result.output, /version 1\.0\.0 must be greater than same-provider base version 1\.0\.0/);
}));

test("policy checker rejects relocation with regex metacharacter lookalike", () => withRepository((root) => {
  writeJson(root, "plugins/itixo+-claude/.claude-plugin/plugin.json", plugin("itixo+", "1.0.0"));
  fs.writeFileSync(path.join(root, "plugins/itixo+-claude/README.md"), "plugins/itixooo-claude\n");
  writeJson(root, ".claude-plugin/marketplace.json", marketplace({
    name: "itixo+",
    source: "./plugins/itixo+-claude",
    description: "itixo plugin",
    category: "Developer Tools",
  }));
  const base = commit(root, "baseline");
  fs.mkdirSync(path.join(root, "plugins/claude"), { recursive: true });
  fs.renameSync(path.join(root, "plugins/itixo+-claude"), path.join(root, "plugins/claude/itixo+"));
  fs.writeFileSync(path.join(root, "plugins/claude/itixo+/README.md"), "plugins/claude/itixo+\n");
  writeJson(root, ".claude-plugin/marketplace.json", marketplace({
    name: "itixo+",
    source: "./plugins/claude/itixo+",
    description: "itixo plugin",
    category: "Developer Tools",
  }));
  commit(root, "relocate lookalike path");

  const result = runChecker(root, base, "");

  assert.equal(result.status, 1);
  assert.match(result.output, /version 1\.0\.0 must be greater than same-provider base version 1\.0\.0/);
}));

test("policy checker rejects valid-UTF8 binary-like relocation changes", () => withRepository((root) => {
  writeJson(root, "plugins/itixo-claude/.claude-plugin/plugin.json", plugin("itixo", "1.0.0"));
  fs.writeFileSync(path.join(root, "plugins/itixo-claude/icon.png"), Buffer.concat([
    Buffer.from([0, 1, 2, 3]),
    Buffer.from("plugins/itixo-claude"),
    Buffer.from([4, 5, 6, 7]),
  ]));
  writeJson(root, ".claude-plugin/marketplace.json", marketplace({
    name: "itixo",
    source: "./plugins/itixo-claude",
    description: "itixo plugin",
    category: "Developer Tools",
  }));
  const base = commit(root, "baseline");
  fs.mkdirSync(path.join(root, "plugins/claude"), { recursive: true });
  fs.renameSync(path.join(root, "plugins/itixo-claude"), path.join(root, "plugins/claude/itixo"));
  fs.writeFileSync(path.join(root, "plugins/claude/itixo/icon.png"), Buffer.concat([
    Buffer.from([0, 1, 2, 3]),
    Buffer.from("plugins/claude/itixo"),
    Buffer.from([4, 5, 6, 7]),
  ]));
  writeJson(root, ".claude-plugin/marketplace.json", marketplace({
    name: "itixo",
    source: "./plugins/claude/itixo",
    description: "itixo plugin",
    category: "Developer Tools",
  }));
  commit(root, "relocate plugin");

  const result = runChecker(root, base, "");

  assert.equal(result.status, 1);
  assert.match(result.output, /version 1\.0\.0 must be greater than same-provider base version 1\.0\.0/);
}));

test("policy checker rejects legacy relocation with reverse path reference", () => withRepository((root) => {
  writeJson(root, "plugins/itixo-claude/.claude-plugin/plugin.json", plugin("itixo", "1.0.0"));
  fs.writeFileSync(path.join(root, "plugins/itixo-claude/README.md"), "Install from plugins/itixo-claude.\n");
  writeJson(root, ".claude-plugin/marketplace.json", marketplace({
    name: "itixo",
    source: "./plugins/itixo-claude",
    description: "itixo plugin",
    category: "Developer Tools",
  }));
  const base = commit(root, "baseline");
  fs.mkdirSync(path.join(root, "plugins/claude"), { recursive: true });
  fs.renameSync(path.join(root, "plugins/itixo-claude"), path.join(root, "plugins/claude/itixo"));
  writeJson(root, ".claude-plugin/marketplace.json", marketplace({
    name: "itixo",
    source: "./plugins/claude/itixo",
    description: "itixo plugin",
    category: "Developer Tools",
  }));
  commit(root, "relocate plugin");

  const result = runChecker(root, base, "");

  assert.equal(result.status, 1);
  assert.match(result.output, /version 1\.0\.0 must be greater than same-provider base version 1\.0\.0/);
}));

test("policy checker rejects legacy relocation with mode change", () => withRepository((root) => {
  writeJson(root, "plugins/itixo-claude/.claude-plugin/plugin.json", plugin("itixo", "1.0.0"));
  writeJson(root, ".claude-plugin/marketplace.json", marketplace({
    name: "itixo",
    source: "./plugins/itixo-claude",
    description: "itixo plugin",
    category: "Developer Tools",
  }));
  const base = commit(root, "baseline");
  fs.mkdirSync(path.join(root, "plugins/claude"), { recursive: true });
  fs.renameSync(path.join(root, "plugins/itixo-claude"), path.join(root, "plugins/claude/itixo"));
  fs.chmodSync(path.join(root, "plugins/claude/itixo/.claude-plugin/plugin.json"), 0o755);
  writeJson(root, ".claude-plugin/marketplace.json", marketplace({
    name: "itixo",
    source: "./plugins/claude/itixo",
    description: "itixo plugin",
    category: "Developer Tools",
  }));
  commit(root, "relocate and change mode");

  const result = runChecker(root, base, "");

  assert.equal(result.status, 1);
  assert.match(result.output, /version 1\.0\.0 must be greater than same-provider base version 1\.0\.0/);
}));

test("policy checker rejects legacy relocation with plugin content change", () => withRepository((root) => {
  writeJson(root, "plugins/itixo-claude/.claude-plugin/plugin.json", plugin("itixo", "1.0.0"));
  writeJson(root, ".claude-plugin/marketplace.json", marketplace({
    name: "itixo",
    source: "./plugins/itixo-claude",
    description: "itixo plugin",
    category: "Developer Tools",
  }));
  const base = commit(root, "baseline");
  fs.mkdirSync(path.join(root, "plugins/claude"), { recursive: true });
  fs.renameSync(path.join(root, "plugins/itixo-claude"), path.join(root, "plugins/claude/itixo"));
  fs.writeFileSync(path.join(root, "plugins/claude/itixo/README.md"), "changed plugin content\n");
  writeJson(root, ".claude-plugin/marketplace.json", marketplace({
    name: "itixo",
    source: "./plugins/claude/itixo",
    description: "itixo plugin",
    category: "Developer Tools",
  }));
  commit(root, "relocate and change plugin");

  const result = runChecker(root, base, "");

  assert.equal(result.status, 1);
  assert.match(result.output, /version 1\.0\.0 must be greater than same-provider base version 1\.0\.0/);
}));

test("policy checker rejects legacy relocation with changed binary content", () => withRepository((root) => {
  writeJson(root, "plugins/itixo-claude/.claude-plugin/plugin.json", plugin("itixo", "1.0.0"));
  fs.writeFileSync(path.join(root, "plugins/itixo-claude/icon.png"), Buffer.from([0, 255]));
  writeJson(root, ".claude-plugin/marketplace.json", marketplace({
    name: "itixo",
    source: "./plugins/itixo-claude",
    description: "itixo plugin",
    category: "Developer Tools",
  }));
  const base = commit(root, "baseline");
  fs.mkdirSync(path.join(root, "plugins/claude"), { recursive: true });
  fs.renameSync(path.join(root, "plugins/itixo-claude"), path.join(root, "plugins/claude/itixo"));
  fs.writeFileSync(path.join(root, "plugins/claude/itixo/icon.png"), Buffer.from([0, 254]));
  writeJson(root, ".claude-plugin/marketplace.json", marketplace({
    name: "itixo",
    source: "./plugins/claude/itixo",
    description: "itixo plugin",
    category: "Developer Tools",
  }));
  commit(root, "relocate and change binary plugin content");

  const result = runChecker(root, base, "");

  assert.equal(result.status, 1);
  assert.match(result.output, /version 1\.0\.0 must be greater than same-provider base version 1\.0\.0/);
}));

test("policy checker rejects plugin content change without version bump", () => withRepository((root) => {
  writeBaselinePlugin(root);
  const base = commit(root, "baseline");
  fs.writeFileSync(path.join(root, "plugins/claude/itixo/README.md"), "changed plugin content\n");
  commit(root, "change plugin");
  const changelog = doc(dateBlock("2026-07-28", [{ version: "1.0.0", body: ["- Note."] }]));

  const result = runChecker(root, base, { claude: changelog });

  assert.equal(result.status, 1);
  assert.match(result.output, /version 1\.0\.0 must be greater than same-provider base version 1\.0\.0/);
}));

test("policy checker accepts bumped version with matching heading", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = doc(dateBlock("2026-07-28", [{ version: "1.0.1", body: ["- Fix."] }]));

  const result = runChecker(root, base, { claude: changelog });

  assert.equal(result.status, 0, result.output);
}));

test("policy checker accepts changed nested manifest with matching heading", () => withRepository((root) => {
  writeJson(root, "plugins/copilot/itixo/plugin.json", plugin("itixo", "1.0.0"));
  const base = commit(root, "baseline");
  writeJson(root, "plugins/copilot/itixo/plugin.json", plugin("itixo", "1.0.1"));
  fs.writeFileSync(path.join(root, "plugins/copilot/itixo/README.md"), "updated plugin content\n");
  commit(root, "bump nested plugin");
  const changelog = doc(dateBlock("2026-07-28", [{ version: "1.0.1", body: ["- Copilot update."] }]));

  const result = runChecker(root, base, { copilot: changelog });

  assert.equal(result.status, 0, result.output);
}));

test("policy checker rejects bumped version without matching heading", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = doc(dateBlock("2026-07-28", [{ version: "1.0.0", body: ["- Fix."] }]));

  const result = runChecker(root, base, { claude: changelog });

  assert.equal(result.status, 1);
  assert.match(result.output, /Changelog: missing heading '#### 1\.0\.1' under '### claude'/);
}));

test("policy checker does not accept a longer version heading as a match", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = doc(dateBlock("2026-07-28", [{ version: "1.0.10", body: ["- Different release."] }]));

  const result = runChecker(root, base, { claude: changelog });

  assert.equal(result.status, 1);
  assert.match(result.output, /Changelog: missing heading '#### 1\.0\.1' under '### claude'/);
}));

test("policy checker requires the version heading to start its own line", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = doc(dateBlock("2026-07-28", [{
    version: "0.9.0",
    body: ["- Notes mention #### 1.0.1 inline text but not a heading."],
  }]));

  const result = runChecker(root, base, { claude: changelog });

  assert.equal(result.status, 1);
  assert.match(result.output, /Changelog: missing heading '#### 1\.0\.1' under '### claude'/);
}));

test("policy checker rejects a lower minor version despite a higher patch", () => withRepository((root) => {
  const base = setupBumpedClaude(root, "1.1.0", "1.0.5");
  const changelog = doc(dateBlock("2026-07-28", [{ version: "1.0.5", body: ["- Patch only."] }]));

  const result = runChecker(root, base, { claude: changelog });

  assert.equal(result.status, 1);
  assert.match(result.output, /version 1\.0\.5 must be greater than same-provider base version 1\.1\.0/);
}));

test("policy checker compares replacement manifest against the base plugin version", () => withRepository((root) => {
  writeBaselinePlugin(root, "claude", "1.2.0");
  const base = commit(root, "baseline");
  fs.rmSync(path.join(root, "plugins/claude/itixo/.claude-plugin"), { recursive: true, force: true });
  writeJson(root, "plugins/claude/itixo/.codex-plugin/plugin.json", plugin("itixo", "0.1.0"));
  commit(root, "replace provider manifest");
  const changelog = doc(dateBlock("2026-07-28", [{ version: "0.1.0", body: ["- Replacement."] }]));

  const result = runChecker(root, base, { claude: changelog });

  assert.equal(result.status, 1);
  assert.match(result.output, /version 0\.1\.0 must be greater than highest base plugin version 1\.2\.0 after provider replacement/);
}));

test("policy checker accepts replacement manifest with a higher version", () => withRepository((root) => {
  writeBaselinePlugin(root, "claude", "1.2.0");
  const base = commit(root, "baseline");
  fs.rmSync(path.join(root, "plugins/claude/itixo/.claude-plugin"), { recursive: true, force: true });
  writeJson(root, "plugins/claude/itixo/.codex-plugin/plugin.json", plugin("itixo", "1.2.1"));
  commit(root, "replace provider manifest");
  const changelog = doc(dateBlock("2026-07-28", [{ version: "1.2.1", body: ["- Provider migration."] }]));

  const result = runChecker(root, base, { claude: changelog });

  assert.equal(result.status, 0, result.output);
}));

test("policy checker treats marketplace-only category changes as plugin changes", () => withRepository((root) => {
  writeBaselinePlugin(root);
  const base = commit(root, "baseline");
  writeJson(root, ".claude-plugin/marketplace.json", marketplace({
    name: "itixo",
    source: "./plugins/claude/itixo",
    description: "itixo plugin",
    category: "Productivity",
  }));
  commit(root, "change category");
  const changelog = doc(dateBlock("2026-07-28", [{ version: "1.0.0", body: ["- Note."] }]));

  const result = runChecker(root, base, { claude: changelog });

  assert.equal(result.status, 1);
  assert.match(result.output, /version 1\.0\.0 must be greater than same-provider base version 1\.0\.0/);
}));

test("policy checker uses marketplace source folder for shared plugin names", () => withRepository((root) => {
  writeJson(root, "plugins/claude/itixo/.claude-plugin/plugin.json", plugin("itixo", "0.6.0"));
  writeJson(root, ".claude-plugin/marketplace.json", marketplace({
    name: "itixo",
    source: "./plugins/claude/itixo",
    description: "Claude plugin",
    category: "Developer Tools",
  }));
  const base = commit(root, "baseline");
  writeJson(root, ".claude-plugin/marketplace.json", marketplace({
    name: "itixo",
    source: "./plugins/claude/itixo",
    description: "Claude plugin",
    category: "Productivity",
  }));
  commit(root, "change category");

  const result = runChecker(root, base);

  assert.equal(result.status, 1);
  assert.match(result.output, /plugins\/claude\/itixo\/\.claude-plugin\/plugin\.json: version 0\.6\.0 must be greater/);
  assert.doesNotMatch(result.output, /Plugin 'itixo' was deleted/);
}));

test("policy checker accepts another nested plugin with strict version and matching heading", () => withRepository((root) => {
  fs.writeFileSync(path.join(root, "README.md"), "baseline\n");
  const base = commit(root, "baseline");
  writeJson(root, "plugins/codex/second/.claude-plugin/plugin.json", plugin("second", "0.1.0"));
  commit(root, "add plugin");
  const changelog = doc(dateBlock("2026-07-28", [{ version: "0.1.0", body: ["- New plugin."] }]));

  const result = runChecker(root, base, { codex: changelog });

  assert.equal(result.status, 0, result.output);
}));

test("policy checker explicitly skips fully deleted plugins", () => withRepository((root) => {
  writeBaselinePlugin(root);
  const base = commit(root, "baseline");
  fs.rmSync(path.join(root, "plugins/claude/itixo"), { recursive: true, force: true });
  commit(root, "delete plugin");

  const result = runChecker(root, base);

  assert.equal(result.status, 0, result.output);
  assert.match(result.stdout, /Plugin 'claude\/itixo' was deleted; no HEAD manifest to validate/);
}));

test("policy checker skips deleted legacy plugins by provider", () => withRepository((root) => {
  writeJson(root, "plugins/itixo-claude/.claude-plugin/plugin.json", plugin("itixo", "1.0.0"));
  const base = commit(root, "baseline");
  fs.rmSync(path.join(root, "plugins/itixo-claude"), { recursive: true, force: true });
  commit(root, "delete legacy plugin");

  const result = runChecker(root, base, "");

  assert.equal(result.status, 0, result.output);
  assert.match(result.stdout, /Plugin 'claude\/itixo' was deleted; no HEAD manifest to validate/);
}));

test("policy checker accepts legacy relocation in backtick-quoted paths", () => withRepository((root) => {
  writeJson(root, "plugins/itixo-claude/.claude-plugin/plugin.json", plugin("itixo", "1.0.0"));
  fs.writeFileSync(path.join(root, "plugins/itixo-claude/README.md"), "Use `plugins/itixo-claude`.\n");
  writeJson(root, ".claude-plugin/marketplace.json", marketplace({
    name: "itixo",
    source: "./plugins/itixo-claude",
    description: "itixo plugin",
    category: "Developer Tools",
  }));
  const base = commit(root, "baseline");
  fs.mkdirSync(path.join(root, "plugins/claude"), { recursive: true });
  fs.renameSync(path.join(root, "plugins/itixo-claude"), path.join(root, "plugins/claude/itixo"));
  fs.writeFileSync(path.join(root, "plugins/claude/itixo/README.md"), "Use `plugins/claude/itixo`.\n");
  writeJson(root, ".claude-plugin/marketplace.json", marketplace({
    name: "itixo",
    source: "./plugins/claude/itixo",
    description: "itixo plugin",
    category: "Developer Tools",
  }));
  commit(root, "relocate plugin");

  const result = runChecker(root, base, "");

  assert.equal(result.status, 0, result.output);
}));

test("git buffer returns null when git show fails", () => {
  assert.equal(gitBuffer(["show", "does-not-exist"]), null);
});

test("policy checker allows historical releases for providers no longer present", () => withRepository((root) => {
  writeBaselinePlugins(root, [["claude", "1.0.0"], ["codex", "9.0.0"]]);
  const base = commit(root, "baseline");
  writeJson(root, "plugins/claude/itixo/.claude-plugin/plugin.json", plugin("itixo", "1.0.1"));
  fs.rmSync(path.join(root, "plugins/codex/itixo"), { recursive: true, force: true });
  commit(root, "bump claude and retire codex");
  const claudeChangelog = doc(dateBlock("2026-07-28", [{ version: "1.0.1", body: ["- Current release."] }]));
  const codexChangelog = doc(dateBlock("2026-07-20", [{ version: "9.0.0", body: ["- Historical release for retired plugin."] }]));
  const copilotChangelog = doc(dateBlock("2026-07-20", [{ version: "0.1.0", body: ["- Historical release, provider never installed."] }]));

  const result = runChecker(root, base, { claude: claudeChangelog, codex: codexChangelog, copilot: copilotChangelog });

  assert.equal(result.status, 0, result.output);
  assert.match(result.stdout, /Plugin 'codex\/itixo' was deleted/);
}));

test("policy checker reports a missing changelog file per provider and keeps checking the others", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = doc(dateBlock("2026-07-28", [{ version: "1.0.1", body: ["- Fix."] }]));

  const result = runChecker(root, base, { claude: changelog, codex: null, copilot: null });

  assert.equal(result.status, 1);
  assert.match(result.output, /Changelog not found: .*changelog\.codex\.md/);
  assert.match(result.output, /Changelog not found: .*changelog\.copilot\.md/);
  assert.doesNotMatch(result.output, /Changelog: missing heading '#### 1\.0\.1' under '### claude'/);
}));

test("policy checker rejects a plugin directory with an unmapped provider", () => withRepository((root) => {
  writeBaselinePlugin(root, "not-itixo-prefixed", "1.0.0");
  const base = commit(root, "baseline");
  writeJson(root, "plugins/not-itixo-prefixed/itixo/.claude-plugin/plugin.json", plugin("itixo", "1.0.1"));
  commit(root, "bump plugin");
  const changelog = doc(dateBlock("2026-07-28", [{ version: "1.0.1", body: ["- Fix."] }]));

  const result = runChecker(root, base, { claude: changelog });

  assert.equal(result.status, 1);
  assert.match(result.output, /plugins\/not-itixo-prefixed\/itixo: unknown provider; add it to PROVIDERS in scripts\/providers\.js\./);
}));

test("policy checker rejects a bodyless version", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = doc(dateBlock("2026-07-28", [{ version: "1.0.1" }]));

  const result = runChecker(root, base, { claude: changelog });

  assert.equal(result.status, 1);
  assert.match(result.output, /version '#### 1\.0\.1' must have at least one '- ' bullet line\./);
}));

test("policy checker does not enforce bullet formatting inside fenced code blocks", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = [
    "### 2026-07-28",
    "",
    "#### 1.0.1",
    "",
    "- Fix.",
    "",
    "```",
    "Not a bullet line inside a fence.",
    "```",
    "",
  ].join("\n");

  const result = runChecker(root, base, { claude: changelog });

  assert.equal(result.status, 0, result.output);
}));

// --- changelog grammar ---

test("policy checker rejects a top-level '#' heading", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = "# Changelog\n\n### 2026-07-28\n\n#### 1.0.1\n\n- Fix.\n";

  const result = runChecker(root, base, { claude: changelog });

  assert.equal(result.status, 1);
  assert.match(result.output, /only '### YYYY-MM-DD' and '#### MAJOR\.MINOR\.PATCH' headings are allowed; got "# Changelog"\./);
}));

test("policy checker rejects a '##' heading", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = "### 2026-07-28\n\n## Claude\n\n#### 1.0.1\n\n- Fix.\n";

  const result = runChecker(root, base, { claude: changelog });

  assert.equal(result.status, 1);
  assert.match(result.output, /only '### YYYY-MM-DD' and '#### MAJOR\.MINOR\.PATCH' headings are allowed; got "## Claude"\./);
}));

test("policy checker rejects a malformed date heading", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = "### 2026/07/28\n\n#### 1.0.1\n\n- Fix.\n";

  const result = runChecker(root, base, { claude: changelog });

  assert.equal(result.status, 1);
  assert.match(result.output, /date heading must be exactly '### YYYY-MM-DD' with a real calendar date; got/);
}));

test("policy checker rejects a date heading with an invalid calendar date", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = "### 2026-02-30\n\n#### 1.0.1\n\n- Fix.\n";

  const result = runChecker(root, base, { claude: changelog });

  assert.equal(result.status, 1);
  assert.match(result.output, /date heading must be exactly '### YYYY-MM-DD' with a real calendar date; got/);
}));

test("policy checker rejects a duplicate date section", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = doc(
    dateBlock("2026-07-28", [{ version: "1.0.1", body: ["- Fix."] }]),
    dateBlock("2026-07-28", [{ version: "1.0.0", body: ["- Old."] }]),
  );

  const result = runChecker(root, base, { claude: changelog });

  assert.equal(result.status, 1);
  assert.match(result.output, /duplicate date section '### 2026-07-28'; each date may appear once\./);
}));

test("policy checker rejects date sections that are not strictly descending", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = doc(
    dateBlock("2026-07-20", [{ version: "1.0.1", body: ["- Fix."] }]),
    dateBlock("2026-07-28", [{ version: "1.0.0", body: ["- Old."] }]),
  );

  const result = runChecker(root, base, { claude: changelog });

  assert.equal(result.status, 1);
  assert.match(result.output, /date sections must be strictly descending; '2026-07-28' must be earlier than '2026-07-20'\./);
}));

test("policy checker rejects a date section with no version headings", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = "### 2026-07-28\n";

  const result = runChecker(root, base, { claude: changelog });

  assert.equal(result.status, 1);
  assert.match(result.output, /date section '2026-07-28' must contain at least one version heading\./);
}));

test("policy checker rejects content between a date heading and its first version heading", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = "### 2026-07-28\n\nNot allowed here.\n\n#### 1.0.1\n\n- Fix.\n";

  const result = runChecker(root, base, { claude: changelog });

  assert.equal(result.status, 1);
  assert.match(result.output, /content between '### 2026-07-28' and its first '#### <version>' heading is not allowed; got "Not allowed here\."\./);
}));

test("policy checker rejects an orphan version heading before any date heading", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = "#### 1.0.1\n\n- Fix.\n\n### 2026-07-28\n\n#### 1.0.0\n\n- Old.\n";

  const result = runChecker(root, base, { claude: changelog });

  assert.equal(result.status, 1);
  assert.match(result.output, /version heading '#### 1\.0\.1' is an orphan; it must follow a date heading\./);
}));

test("policy checker rejects a malformed version heading", () => withRepository((root) => {
  const base = setupBumpedClaude(root);

  for (const headingLine of ["#### 1.0.1-beta", "#### 1.0.1 extra"]) {
    const changelog = `### 2026-07-28\n\n${headingLine}\n\n- Fix.\n`;
    const result = runChecker(root, base, { claude: changelog });
    assert.equal(result.status, 1, headingLine);
    assert.match(result.output, /version heading must be exactly '#### MAJOR\.MINOR\.PATCH'; got/, headingLine);
  }
}));

test("policy checker rejects a duplicate version heading", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = doc(dateBlock("2026-07-28", [
    { version: "1.0.1", body: ["- First."] },
    { version: "1.0.1", body: ["- Duplicate."] },
  ]));

  const result = runChecker(root, base, { claude: changelog });

  assert.equal(result.status, 1);
  assert.match(result.output, /duplicate version heading '#### 1\.0\.1'; each version may appear at most once\./);
}));

test("policy checker rejects versions that do not strictly descend within a date section", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = doc(dateBlock("2026-07-28", [
    { version: "1.0.0", body: ["- Older first."] },
    { version: "1.0.1", body: ["- Newer second."] },
  ]));

  const result = runChecker(root, base, { claude: changelog });

  assert.equal(result.status, 1);
  assert.match(result.output, /versions must be strictly descending; '1\.0\.1' must be lower than '1\.0\.0'\./);
}));

test("policy checker rejects versions that do not strictly descend across date sections", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = doc(
    dateBlock("2026-07-28", [{ version: "1.0.0", body: ["- Newer date, lower version."] }]),
    dateBlock("2026-07-20", [{ version: "1.0.1", body: ["- Older date, higher version."] }]),
  );

  const result = runChecker(root, base, { claude: changelog });

  assert.equal(result.status, 1);
  assert.match(result.output, /versions must be strictly descending; '1\.0\.1' must be lower than '1\.0\.0'\./);
}));

test("policy checker rejects malformed bullet lines in a version body", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = "### 2026-07-28\n\n#### 1.0.1\n\nNot a bullet line.\n";

  const result = runChecker(root, base, { claude: changelog });

  assert.equal(result.status, 1);
  assert.match(result.output, /version body for '#### 1\.0\.1' must be '- ' bullet lines; got "Not a bullet line\."\./);
}));

test("validation workflow runs required checks for PR and manual dispatch", () => {
  const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/validate-plugins.yml"), "utf8");

  assert.match(workflow, /^\s*pull_request:\s*$/m);
  assert.match(workflow, /^\s*workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /\bref:[^\n]*pull_request\.head\.sha/);
  assert.match(workflow, /node scripts\/generate-agents\.js --check/);
  assert.match(workflow, /node --test tests\/\*\.test\.js/);
  assert.match(workflow, /node tests\/validate\.js/);
  assert.match(workflow, /node scripts\/validate-plugin-changes\.js --base/);
});

test("validation workflow validates root changelog without Wiki access", () => {
  const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/validate-plugins.yml"), "utf8");

  assert.match(workflow, /node scripts\/validate-plugin-changes\.js --base[\s\S]*?--changelog-dir \./);
  assert.doesNotMatch(workflow, /\.wiki\.git/);
  assert.doesNotMatch(workflow, /x-access-token|AUTHORIZATION:\s*basic|include\.path/i);
});

test("Wiki update workflow syncs per-provider changelogs to Wiki master", () => {
  const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/wiki-update.yml"), "utf8");

  assert.match(workflow, /^name:\s*Wiki update\s*$/m);
  assert.match(workflow, /^\s*push:\s*\n\s*branches:\s*\n\s*- main\s*$/m);
  assert.match(workflow, /git clone --branch master --single-branch[\s\S]*?\.wiki\.git[\s\S]*?\s+wiki/);
  assert.match(workflow, /for provider in claude codex copilot; do/);
  assert.ok(workflow.includes('cat "changelog.$provider.md"'), "reads changelog.$provider.md per provider");
  assert.ok(workflow.includes('"# Changelog"'), "composes a # Changelog heading");
  assert.match(workflow, /cmp -s [^\n]*wiki\/Changelog\.md/);
  assert.match(workflow, /Wiki changelog already current\.[\s\S]*?exit 0/);
  assert.match(workflow, /cp [^\n]*wiki\/Changelog\.md/);
  assert.match(workflow, /git -C wiki add Changelog\.md/);
  assert.match(workflow, /git -C wiki commit -m "docs: sync changelog"/);
  assert.match(workflow, /git -C wiki push origin HEAD:master/);
});

test("policy checker accepts multiple plugins bumped across different providers in one PR", () => withRepository((root) => {
  writeBaselinePlugins(root, [["claude", "1.0.0"], ["codex", "1.0.0"]]);
  const base = commit(root, "baseline");
  writeJson(root, "plugins/claude/itixo/.claude-plugin/plugin.json", plugin("itixo", "1.0.1"));
  writeJson(root, "plugins/codex/itixo/.claude-plugin/plugin.json", plugin("itixo", "2.0.0"));
  commit(root, "bump both providers");
  const claudeChangelog = doc(dateBlock("2026-07-28", [{ version: "1.0.1", body: ["- Claude fix."] }]));
  const codexChangelog = doc(dateBlock("2026-07-28", [{ version: "2.0.0", body: ["- Codex release."] }]));

  const result = runChecker(root, base, { claude: claudeChangelog, codex: codexChangelog });

  assert.equal(result.status, 0, result.output);
}));

test("policy checker rejects one of two bumped providers missing its changelog heading", () => withRepository((root) => {
  writeBaselinePlugins(root, [["claude", "1.0.0"], ["codex", "1.0.0"]]);
  const base = commit(root, "baseline");
  writeJson(root, "plugins/claude/itixo/.claude-plugin/plugin.json", plugin("itixo", "1.0.1"));
  writeJson(root, "plugins/codex/itixo/.claude-plugin/plugin.json", plugin("itixo", "2.0.0"));
  commit(root, "bump both providers");
  const claudeChangelog = doc(dateBlock("2026-07-28", [{ version: "1.0.1", body: ["- Claude fix."] }]));
  const codexChangelog = doc(dateBlock("2026-07-28", [{ version: "1.9.0", body: ["- Unrelated codex entry."] }]));

  const result = runChecker(root, base, { claude: claudeChangelog, codex: codexChangelog });

  assert.equal(result.status, 1);
  assert.match(result.output, /Changelog: missing heading '#### 2\.0\.0' under '### codex'/);
  assert.doesNotMatch(result.output, /Changelog: missing heading '#### 1\.0\.1' under '### claude'/);
}));

test("policy checker validates two plugins under the same provider against one changelog file", () => withRepository((root) => {
  writeJson(root, "plugins/claude/itixo/.claude-plugin/plugin.json", plugin("itixo", "1.0.0"));
  writeJson(root, "plugins/claude/other/.claude-plugin/plugin.json", plugin("other", "1.0.0"));
  const base = commit(root, "baseline");
  writeJson(root, "plugins/claude/itixo/.claude-plugin/plugin.json", plugin("itixo", "1.0.1"));
  writeJson(root, "plugins/claude/other/.claude-plugin/plugin.json", plugin("other", "2.0.0"));
  commit(root, "bump both claude plugins");
  const changelog = doc(dateBlock("2026-07-28", [
    { version: "2.0.0", body: ["- Other plugin release."] },
    { version: "1.0.1", body: ["- Itixo fix."] },
  ]));

  const result = runChecker(root, base, { claude: changelog });

  assert.equal(result.status, 0, result.output);
}));

test("policy checker rejects a malformed plugin layout key from a non-standard marketplace source", () => withRepository((root) => {
  writeJson(root, ".claude-plugin/marketplace.json", marketplace({
    name: "solo-plugin",
    source: "./tools/solo-plugin",
    description: "solo plugin",
    category: "Developer Tools",
  }));
  const base = commit(root, "baseline");
  writeJson(root, ".claude-plugin/marketplace.json", marketplace({
    name: "solo-plugin",
    source: "./tools/solo-plugin",
    description: "solo plugin",
    category: "Productivity",
  }));
  commit(root, "change category");

  const result = runChecker(root, base);

  assert.equal(result.status, 1);
  assert.match(result.output, /plugins\/solo-plugin: unknown plugin layout; expected plugins\/<provider>\/<plugin>\./);
}));
