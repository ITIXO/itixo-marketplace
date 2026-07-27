"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const CHECKER = path.join(ROOT, "scripts", "validate-plugin-changes.js");

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

function writeBaselinePlugin(root, name = "sample", version = "1.0.0") {
  writeBaselinePlugins(root, [[name, version]]);
}

function writeBaselinePlugins(root, entries) {
  for (const [name, version] of entries) {
    writeJson(root, `plugins/${name}/.claude-plugin/plugin.json`, plugin(name, version));
  }
  writeJson(root, ".claude-plugin/marketplace.json", marketplace(...entries.map(([name]) => ({
    name,
    source: `./plugins/${name}`,
    description: `${name} plugin`,
    category: "Developer Tools",
  }))));
}

function release(pluginName, version, suffix = "", body = "- Release details.") {
  const headingSuffix = suffix ? ` ${suffix}` : "";
  return `## ${pluginName}\n\n### ${version}${headingSuffix}\n\n${body}\n`;
}

function runChecker(root, base, changelog = "") {
  const changelogPath = path.join(root, "Changelog.md");
  if (changelog !== null) fs.writeFileSync(changelogPath, changelog);
  const result = spawnSync(process.execPath, [CHECKER, "--base", base, "--changelog", changelogPath], {
    cwd: root,
    encoding: "utf8",
  });
  return { ...result, output: `${result.stdout}${result.stderr}` };
}

test("policy checker passes when no plugin changed", () => withRepository((root) => {
  writeBaselinePlugin(root);
  const base = commit(root, "baseline");

  const result = runChecker(root, base, null);

  assert.equal(result.status, 0, result.output);
  assert.match(result.stdout, /Plugin release policy validation passed/);
}));

test("policy checker rejects plugin content change without version bump", () => withRepository((root) => {
  writeBaselinePlugin(root);
  const base = commit(root, "baseline");
  fs.writeFileSync(path.join(root, "plugins/sample/README.md"), "changed plugin content\n");
  commit(root, "change plugin");

  const result = runChecker(root, base, release("sample", "1.0.0"));

  assert.equal(result.status, 1);
  assert.match(result.output, /version 1\.0\.0 must be greater than same-provider base version 1\.0\.0/);
}));

test("policy checker accepts bumped version with matching Wiki heading", () => withRepository((root) => {
  writeBaselinePlugin(root);
  const base = commit(root, "baseline");
  writeJson(root, "plugins/sample/.claude-plugin/plugin.json", plugin("sample", "1.0.1"));
  commit(root, "bump plugin");

  const result = runChecker(root, base, release("sample", "1.0.1", "— Fix"));

  assert.equal(result.status, 0, result.output);
}));

test("policy checker rejects bumped version without matching Wiki heading", () => withRepository((root) => {
  writeBaselinePlugin(root);
  const base = commit(root, "baseline");
  writeJson(root, "plugins/sample/.claude-plugin/plugin.json", plugin("sample", "1.0.1"));
  commit(root, "bump plugin");

  const result = runChecker(root, base, release("sample", "1.0.0"));

  assert.equal(result.status, 1);
  assert.match(result.output, /Changelog: missing heading '### 1\.0\.1'/);
}));

test("policy checker does not accept a longer version heading as a match", () => withRepository((root) => {
  writeBaselinePlugin(root);
  const base = commit(root, "baseline");
  writeJson(root, "plugins/sample/.claude-plugin/plugin.json", plugin("sample", "1.0.1"));
  commit(root, "bump plugin");

  const result = runChecker(root, base, release("sample", "1.0.10", "— Different release"));

  assert.equal(result.status, 1);
  assert.match(result.output, /Changelog: missing heading '### 1\.0\.1'/);
}));

test("policy checker requires the version heading to start its own line", () => withRepository((root) => {
  writeBaselinePlugin(root);
  const base = commit(root, "baseline");
  writeJson(root, "plugins/sample/.claude-plugin/plugin.json", plugin("sample", "1.0.1"));
  commit(root, "bump plugin");

  const result = runChecker(root, base, "## sample\n\nRelease notes mention ### 1.0.1 inline.\n");

  assert.equal(result.status, 1);
  assert.match(result.output, /Changelog: missing heading '### 1\.0\.1'/);
}));

test("policy checker rejects a lower minor version despite a higher patch", () => withRepository((root) => {
  writeBaselinePlugin(root, "sample", "1.1.0");
  const base = commit(root, "baseline");
  writeJson(root, "plugins/sample/.claude-plugin/plugin.json", plugin("sample", "1.0.5"));
  commit(root, "change version");

  const result = runChecker(root, base, release("sample", "1.0.5"));

  assert.equal(result.status, 1);
  assert.match(result.output, /version 1\.0\.5 must be greater than same-provider base version 1\.1\.0/);
}));

test("policy checker compares replacement manifest against the base plugin version", () => withRepository((root) => {
  writeBaselinePlugin(root, "sample", "1.2.0");
  const base = commit(root, "baseline");
  fs.rmSync(path.join(root, "plugins/sample/.claude-plugin"), { recursive: true, force: true });
  writeJson(root, "plugins/sample/.codex-plugin/plugin.json", plugin("sample", "0.1.0"));
  commit(root, "replace provider manifest");

  const result = runChecker(root, base, release("sample", "0.1.0"));

  assert.equal(result.status, 1);
  assert.match(result.output, /version 0\.1\.0 must be greater than highest base plugin version 1\.2\.0 after provider replacement/);
}));

test("policy checker accepts replacement manifest with a higher version", () => withRepository((root) => {
  writeBaselinePlugin(root, "sample", "1.2.0");
  const base = commit(root, "baseline");
  fs.rmSync(path.join(root, "plugins/sample/.claude-plugin"), { recursive: true, force: true });
  writeJson(root, "plugins/sample/.codex-plugin/plugin.json", plugin("sample", "1.2.1"));
  commit(root, "replace provider manifest");

  const result = runChecker(root, base, release("sample", "1.2.1", "— Provider migration"));

  assert.equal(result.status, 0, result.output);
}));

test("policy checker treats marketplace-only category changes as plugin changes", () => withRepository((root) => {
  writeBaselinePlugin(root);
  const base = commit(root, "baseline");
  writeJson(root, ".claude-plugin/marketplace.json", marketplace({
    name: "sample",
    source: "./plugins/sample",
    description: "sample plugin",
    category: "Productivity",
  }));
  commit(root, "change category");

  const result = runChecker(root, base, release("sample", "1.0.0"));

  assert.equal(result.status, 1);
  assert.match(result.output, /version 1\.0\.0 must be greater than same-provider base version 1\.0\.0/);
}));

test("policy checker accepts new plugin with strict version and Wiki heading", () => withRepository((root) => {
  fs.writeFileSync(path.join(root, "README.md"), "baseline\n");
  const base = commit(root, "baseline");
  writeJson(root, "plugins/new-plugin/.claude-plugin/plugin.json", plugin("new-plugin", "0.1.0"));
  commit(root, "add plugin");

  const result = runChecker(root, base, release("new-plugin", "0.1.0", "— New plugin"));

  assert.equal(result.status, 0, result.output);
}));

test("policy checker explicitly skips fully deleted plugins", () => withRepository((root) => {
  writeBaselinePlugin(root);
  const base = commit(root, "baseline");
  fs.rmSync(path.join(root, "plugins/sample"), { recursive: true, force: true });
  commit(root, "delete plugin");

  const result = runChecker(root, base, "");

  assert.equal(result.status, 0, result.output);
  assert.match(result.stdout, /Plugin 'sample' was deleted; no HEAD manifest to validate/);
}));

test("policy checker requires the changed plugin's exact section, not a prefix or wrong plugin", () => withRepository((root) => {
  writeBaselinePlugins(root, [["sample", "1.0.0"], ["sample-extra", "1.0.0"]]);
  const base = commit(root, "baseline");
  writeJson(root, "plugins/sample/.claude-plugin/plugin.json", plugin("sample", "1.0.1"));
  commit(root, "bump sample only");

  const result = runChecker(root, base, release("sample-extra", "1.0.1", "— Wrong plugin"));

  assert.equal(result.status, 1, "a version under sample-extra must not satisfy changed plugin sample");
}));

test("policy checker rejects a changelog with no plugin sections", () => withRepository((root) => {
  writeBaselinePlugin(root);
  const base = commit(root, "baseline");
  writeJson(root, "plugins/sample/.claude-plugin/plugin.json", plugin("sample", "1.0.1"));
  commit(root, "bump plugin");

  const result = runChecker(root, base, "# Changelog\n\nNo plugin releases yet.\n");

  assert.equal(result.status, 1);
}));

test("policy checker rejects duplicate plugin sections", () => withRepository((root) => {
  writeBaselinePlugin(root);
  const base = commit(root, "baseline");
  writeJson(root, "plugins/sample/.claude-plugin/plugin.json", plugin("sample", "1.0.1"));
  commit(root, "bump plugin");
  const changelog = [
    release("sample", "1.0.1", "— Current"),
    release("sample", "1.0.0", "— Duplicate section"),
  ].join("\n");

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 1, "duplicate ## sample sections must be rejected");
}));

test("policy checker rejects duplicate releases within one plugin", () => withRepository((root) => {
  writeBaselinePlugin(root);
  const base = commit(root, "baseline");
  writeJson(root, "plugins/sample/.claude-plugin/plugin.json", plugin("sample", "1.0.1"));
  commit(root, "bump plugin");
  const changelog = [
    "## sample",
    "",
    "### 1.0.1 — First",
    "",
    "- First body.",
    "",
    "### 1.0.1 — Duplicate",
    "",
    "- Duplicate body.",
    "",
  ].join("\n");

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 1, "duplicate release version in one plugin must be rejected");
}));

test("policy checker allows the same release version in two exact plugin sections", () => withRepository((root) => {
  writeBaselinePlugins(root, [["first-plugin", "1.0.0"], ["second-plugin", "1.0.0"]]);
  const base = commit(root, "baseline");
  writeJson(root, "plugins/first-plugin/.claude-plugin/plugin.json", plugin("first-plugin", "1.0.1"));
  writeJson(root, "plugins/second-plugin/.claude-plugin/plugin.json", plugin("second-plugin", "1.0.1"));
  commit(root, "bump both plugins");
  const changelog = [
    release("first-plugin", "1.0.1", "(2026-07-23)"),
    release("second-plugin", "1.0.1", "— Independent release"),
  ].join("\n");

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 0, result.output);
}));

test("policy checker rejects release headings before the first plugin section", () => withRepository((root) => {
  writeBaselinePlugin(root);
  const base = commit(root, "baseline");
  writeJson(root, "plugins/sample/.claude-plugin/plugin.json", plugin("sample", "1.0.1"));
  commit(root, "bump plugin");
  const changelog = [
    "### 9.9.9 — Orphan release",
    "",
    "- Has no owning plugin.",
    "",
    release("sample", "1.0.1"),
  ].join("\n");

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 1, "release before any ## plugin section must be rejected");
}));

test("policy checker rejects an empty release body", () => withRepository((root) => {
  writeBaselinePlugin(root);
  const base = commit(root, "baseline");
  writeJson(root, "plugins/sample/.claude-plugin/plugin.json", plugin("sample", "1.0.1"));
  commit(root, "bump plugin");
  const changelog = [
    "## sample",
    "",
    "### 1.0.1 — Empty",
    "",
    "## historical-plugin",
    "",
    "### 0.1.0",
    "",
    "- Historical body.",
    "",
  ].join("\n");

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 1, "release content before the next section must be non-empty");
}));

test("policy checker rejects legacy provider-prefixed and combined release headings", () => withRepository((root) => {
  writeBaselinePlugin(root);
  const base = commit(root, "baseline");
  writeJson(root, "plugins/sample/.claude-plugin/plugin.json", plugin("sample", "1.0.1"));
  commit(root, "bump plugin");
  for (const legacyHeading of [
    "### sample 1.0.0 — Provider-prefixed",
    "### 1.0.0 / 2.0.0 — Combined providers",
  ]) {
    const changelog = [
      release("sample", "1.0.1"),
      legacyHeading,
      "",
      "- Legacy body.",
      "",
    ].join("\n");
    const result = runChecker(root, base, changelog);
    assert.equal(result.status, 1, `${legacyHeading} must be rejected`);
  }
}));

test("policy checker allows semver text in a valid release heading suffix", () => withRepository((root) => {
  writeBaselinePlugin(root, "sample", "1.2.2");
  const base = commit(root, "baseline");
  writeJson(root, "plugins/sample/.claude-plugin/plugin.json", plugin("sample", "1.2.3"));
  commit(root, "bump plugin");

  const result = runChecker(
    root,
    base,
    release("sample", "1.2.3", "— Support API 2.0.0", "- Adds compatibility with API 2.0.0."),
  );

  assert.equal(result.status, 0, result.output);
}));

test("policy checker requires releases to strictly descend within each plugin", () => withRepository((root) => {
  writeBaselinePlugin(root);
  const base = commit(root, "baseline");
  writeJson(root, "plugins/sample/.claude-plugin/plugin.json", plugin("sample", "1.0.2"));
  commit(root, "bump plugin");
  const changelog = [
    "## sample",
    "",
    "### 1.0.1 — Older first",
    "",
    "- Older release.",
    "",
    "### 1.0.2 — Newer second",
    "",
    "- Newer release.",
    "",
  ].join("\n");

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 1, "versions must be strictly descending within ## sample");
}));

test("policy checker allows historical and deleted plugin sections", () => withRepository((root) => {
  writeBaselinePlugins(root, [["sample", "1.0.0"], ["retired-plugin", "9.0.0"]]);
  const base = commit(root, "baseline");
  writeJson(root, "plugins/sample/.claude-plugin/plugin.json", plugin("sample", "1.0.1"));
  fs.rmSync(path.join(root, "plugins/retired-plugin"), { recursive: true, force: true });
  commit(root, "bump sample and retire plugin");
  const changelog = [
    release("sample", "1.0.1", "— Current"),
    release("retired-plugin", "9.0.0", "— Historical"),
    release("never-installed", "0.1.0", "— Historical"),
  ].join("\n");

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 0, result.output);
  assert.match(result.stdout, /Plugin 'retired-plugin' was deleted/);
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

  assert.match(workflow, /node scripts\/validate-plugin-changes\.js --base[\s\S]*?--changelog changelog\.md/);
  assert.doesNotMatch(workflow, /\.wiki\.git/);
  assert.doesNotMatch(workflow, /x-access-token|AUTHORIZATION:\s*basic|include\.path/i);
});

test("Wiki update workflow syncs root changelog to Wiki master", () => {
  const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/wiki-update.yml"), "utf8");

  assert.match(workflow, /^name:\s*Wiki update\s*$/m);
  assert.match(workflow, /^\s*push:\s*\n\s*branches:\s*\n\s*- main\s*$/m);
  assert.match(workflow, /git clone --branch master --single-branch[\s\S]*?\.wiki\.git[\s\S]*?\s+wiki/);
  assert.match(workflow, /cmp -s changelog\.md wiki\/Changelog\.md/);
  assert.match(workflow, /Wiki changelog already current\.[\s\S]*?exit 0/);
  assert.match(workflow, /cp changelog\.md wiki\/Changelog\.md/);
  assert.match(workflow, /git -C wiki add Changelog\.md/);
  assert.match(workflow, /git -C wiki commit -m "docs: sync changelog"/);
  assert.match(workflow, /git -C wiki push origin HEAD:master/);
});
