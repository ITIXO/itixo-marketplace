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
  writeJson(root, `plugins/${name}/.claude-plugin/plugin.json`, plugin(name, version));
  writeJson(root, ".claude-plugin/marketplace.json", marketplace({
    name,
    source: `./plugins/${name}`,
    description: "sample plugin",
    category: "Developer Tools",
  }));
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

  const result = runChecker(root, base, "### 1.0.0\n");

  assert.equal(result.status, 1);
  assert.match(result.output, /version 1\.0\.0 must be greater than same-provider base version 1\.0\.0/);
}));

test("policy checker accepts bumped version with matching Wiki heading", () => withRepository((root) => {
  writeBaselinePlugin(root);
  const base = commit(root, "baseline");
  writeJson(root, "plugins/sample/.claude-plugin/plugin.json", plugin("sample", "1.0.1"));
  commit(root, "bump plugin");

  const result = runChecker(root, base, "### 1.0.1 — Fix\n");

  assert.equal(result.status, 0, result.output);
}));

test("policy checker rejects bumped version without matching Wiki heading", () => withRepository((root) => {
  writeBaselinePlugin(root);
  const base = commit(root, "baseline");
  writeJson(root, "plugins/sample/.claude-plugin/plugin.json", plugin("sample", "1.0.1"));
  commit(root, "bump plugin");

  const result = runChecker(root, base, "### 1.0.0\n");

  assert.equal(result.status, 1);
  assert.match(result.output, /Changelog: missing heading '### 1\.0\.1'/);
}));

test("policy checker does not accept a longer version heading as a match", () => withRepository((root) => {
  writeBaselinePlugin(root);
  const base = commit(root, "baseline");
  writeJson(root, "plugins/sample/.claude-plugin/plugin.json", plugin("sample", "1.0.1"));
  commit(root, "bump plugin");

  const result = runChecker(root, base, "### 1.0.10 — Different release\n");

  assert.equal(result.status, 1);
  assert.match(result.output, /Changelog: missing heading '### 1\.0\.1'/);
}));

test("policy checker requires the version heading to start its own line", () => withRepository((root) => {
  writeBaselinePlugin(root);
  const base = commit(root, "baseline");
  writeJson(root, "plugins/sample/.claude-plugin/plugin.json", plugin("sample", "1.0.1"));
  commit(root, "bump plugin");

  const result = runChecker(root, base, "Release notes mention ### 1.0.1 inline.\n");

  assert.equal(result.status, 1);
  assert.match(result.output, /Changelog: missing heading '### 1\.0\.1'/);
}));

test("policy checker rejects a lower minor version despite a higher patch", () => withRepository((root) => {
  writeBaselinePlugin(root, "sample", "1.1.0");
  const base = commit(root, "baseline");
  writeJson(root, "plugins/sample/.claude-plugin/plugin.json", plugin("sample", "1.0.5"));
  commit(root, "change version");

  const result = runChecker(root, base, "### 1.0.5\n");

  assert.equal(result.status, 1);
  assert.match(result.output, /version 1\.0\.5 must be greater than same-provider base version 1\.1\.0/);
}));

test("policy checker compares replacement manifest against the base plugin version", () => withRepository((root) => {
  writeBaselinePlugin(root, "sample", "1.2.0");
  const base = commit(root, "baseline");
  fs.rmSync(path.join(root, "plugins/sample/.claude-plugin"), { recursive: true, force: true });
  writeJson(root, "plugins/sample/.codex-plugin/plugin.json", plugin("sample", "0.1.0"));
  commit(root, "replace provider manifest");

  const result = runChecker(root, base, "### 0.1.0\n");

  assert.equal(result.status, 1);
  assert.match(result.output, /version 0\.1\.0 must be greater than highest base plugin version 1\.2\.0 after provider replacement/);
}));

test("policy checker accepts replacement manifest with a higher version", () => withRepository((root) => {
  writeBaselinePlugin(root, "sample", "1.2.0");
  const base = commit(root, "baseline");
  fs.rmSync(path.join(root, "plugins/sample/.claude-plugin"), { recursive: true, force: true });
  writeJson(root, "plugins/sample/.codex-plugin/plugin.json", plugin("sample", "1.2.1"));
  commit(root, "replace provider manifest");

  const result = runChecker(root, base, "### 1.2.1 — Provider migration\n");

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

  const result = runChecker(root, base, "### 1.0.0\n");

  assert.equal(result.status, 1);
  assert.match(result.output, /version 1\.0\.0 must be greater than same-provider base version 1\.0\.0/);
}));

test("policy checker accepts new plugin with strict version and Wiki heading", () => withRepository((root) => {
  fs.writeFileSync(path.join(root, "README.md"), "baseline\n");
  const base = commit(root, "baseline");
  writeJson(root, "plugins/new-plugin/.claude-plugin/plugin.json", plugin("new-plugin", "0.1.0"));
  commit(root, "add plugin");

  const result = runChecker(root, base, "### 0.1.0 — New plugin\n");

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

test("validation workflow runs required checks for PR and manual dispatch", () => {
  const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/validate-plugins.yml"), "utf8");

  assert.match(workflow, /^\s*pull_request:\s*$/m);
  assert.match(workflow, /^\s*workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /\bref:[^\n]*pull_request\.head\.sha/);
  assert.match(workflow, /node scripts\/generate-agents\.js --check/);
  assert.match(workflow, /node --test tests\/\*\.test\.js/);
  assert.match(workflow, /node tests\/validate\.js/);
  assert.match(workflow, /\.wiki\.git/);
  assert.match(workflow, /node scripts\/validate-plugin-changes\.js --base/);
});

test("validation workflow authenticates the Wiki clone without persisting credentials", () => {
  const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/validate-plugins.yml"), "utf8");

  assert.match(workflow, /GITHUB_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/);
  assert.match(workflow, /x-access-token/);
  assert.match(workflow, /AUTHORIZATION:\s*basic/i);
  assert.match(workflow, /::add-mask::/);
  assert.match(workflow, /fs\.writeFileSync\([\s\S]*?\{\s*mode:\s*0o600\s*\}/);
  assert.match(workflow, /fs\.chmodSync\(\s*authConfig\s*,\s*0o600\s*\)/);
  assert.match(workflow, /trap\s+['"][^'"]*(?:rm|unset)[^'"]*['"]/i);
  assert.match(workflow, /git(?:\s+-c)?[^\n]*include\.path/);
  assert.doesNotMatch(workflow, /https:\/\/x-access-token:\s*\$\{\{?\s*(?:env\.)?GITHUB_TOKEN\s*\}?\}@github\.com/i);
  assert.doesNotMatch(workflow, /git config(?:\s+--global)?\s+http\.[^\s]+\.extraheader=\s*(?:#.*)?$/im);
});
