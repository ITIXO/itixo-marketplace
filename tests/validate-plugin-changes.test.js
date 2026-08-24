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

// Builds a `### <provider>` section with one or more `#### <version>`
// headings, each with an optional bullet-list body.
function providerBlock(provider, versions) {
  const lines = [`### ${provider}`, ""];
  for (const version of versions) {
    lines.push(`#### ${version.version}`);
    lines.push("");
    for (const bullet of version.body ?? []) lines.push(bullet);
    lines.push("");
  }
  return lines;
}

// Builds a `## YYYY-MM-DD` date section with an optional common bullet list
// and zero or more `### <provider>` sections, each carrying one or more
// `#### <version>` releases.
function dateBlock(date, { common = [], providers = [] } = {}) {
  const lines = [`## ${date}`, ""];
  for (const bullet of common) lines.push(bullet);
  if (common.length) lines.push("");
  for (const providerEntry of providers) {
    lines.push(...providerBlock(providerEntry.provider, providerEntry.versions));
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

test("policy checker accepts legacy layout relocation without release metadata", () => withRepository((root) => {
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

test("policy checker rejects plugin content change without version bump", () => withRepository((root) => {
  writeBaselinePlugin(root);
  const base = commit(root, "baseline");
  fs.writeFileSync(path.join(root, "plugins/claude/itixo/README.md"), "changed plugin content\n");
  commit(root, "change plugin");
  const changelog = doc(dateBlock("2026-07-28", {
    providers: [{ provider: "claude", versions: [{ version: "1.0.0", body: ["- Note."] }] }],
  }));

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 1);
  assert.match(result.output, /version 1\.0\.0 must be greater than same-provider base version 1\.0\.0/);
}));

test("policy checker accepts bumped version with matching heading", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = doc(dateBlock("2026-07-28", {
    providers: [{ provider: "claude", versions: [{ version: "1.0.1", body: ["- Fix."] }] }],
  }));

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 0, result.output);
}));

test("policy checker accepts changed nested manifest with matching heading", () => withRepository((root) => {
  writeJson(root, "plugins/copilot/itixo/plugin.json", plugin("itixo", "1.0.0"));
  const base = commit(root, "baseline");
  writeJson(root, "plugins/copilot/itixo/plugin.json", plugin("itixo", "1.0.1"));
  fs.writeFileSync(path.join(root, "plugins/copilot/itixo/README.md"), "updated plugin content\n");
  commit(root, "bump nested plugin");
  const changelog = doc(dateBlock("2026-07-28", {
    providers: [{ provider: "copilot", versions: [{ version: "1.0.1", body: ["- Copilot update."] }] }],
  }));

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 0, result.output);
}));

test("policy checker rejects bumped version without matching heading", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = doc(dateBlock("2026-07-28", {
    providers: [{ provider: "claude", versions: [{ version: "1.0.0", body: ["- Fix."] }] }],
  }));

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 1);
  assert.match(result.output, /Changelog: missing heading '#### 1\.0\.1' under '### claude'/);
}));

test("policy checker does not accept a longer version heading as a match", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = doc(dateBlock("2026-07-28", {
    providers: [{ provider: "claude", versions: [{ version: "1.0.10", body: ["- Different release."] }] }],
  }));

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 1);
  assert.match(result.output, /Changelog: missing heading '#### 1\.0\.1' under '### claude'/);
}));

test("policy checker requires the version heading to start its own line", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = doc(dateBlock("2026-07-28", {
    common: ["- Notes mention #### 1.0.1 under ### claude inline text but not a heading."],
    providers: [{ provider: "claude", versions: [{ version: "0.9.0", body: ["- Older release, unrelated."] }] }],
  }));

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 1);
  assert.match(result.output, /Changelog: missing heading '#### 1\.0\.1' under '### claude'/);
}));

test("policy checker rejects a lower minor version despite a higher patch", () => withRepository((root) => {
  const base = setupBumpedClaude(root, "1.1.0", "1.0.5");
  const changelog = doc(dateBlock("2026-07-28", {
    providers: [{ provider: "claude", versions: [{ version: "1.0.5", body: ["- Patch only."] }] }],
  }));

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 1);
  assert.match(result.output, /version 1\.0\.5 must be greater than same-provider base version 1\.1\.0/);
}));

test("policy checker compares replacement manifest against the base plugin version", () => withRepository((root) => {
  writeBaselinePlugin(root, "claude", "1.2.0");
  const base = commit(root, "baseline");
  fs.rmSync(path.join(root, "plugins/claude/itixo/.claude-plugin"), { recursive: true, force: true });
  writeJson(root, "plugins/claude/itixo/.codex-plugin/plugin.json", plugin("itixo", "0.1.0"));
  commit(root, "replace provider manifest");
  const changelog = doc(dateBlock("2026-07-28", {
    providers: [{ provider: "claude", versions: [{ version: "0.1.0", body: ["- Replacement."] }] }],
  }));

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 1);
  assert.match(result.output, /version 0\.1\.0 must be greater than highest base plugin version 1\.2\.0 after provider replacement/);
}));

test("policy checker accepts replacement manifest with a higher version", () => withRepository((root) => {
  writeBaselinePlugin(root, "claude", "1.2.0");
  const base = commit(root, "baseline");
  fs.rmSync(path.join(root, "plugins/claude/itixo/.claude-plugin"), { recursive: true, force: true });
  writeJson(root, "plugins/claude/itixo/.codex-plugin/plugin.json", plugin("itixo", "1.2.1"));
  commit(root, "replace provider manifest");
  const changelog = doc(dateBlock("2026-07-28", {
    providers: [{ provider: "claude", versions: [{ version: "1.2.1", body: ["- Provider migration."] }] }],
  }));

  const result = runChecker(root, base, changelog);

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
  const changelog = doc(dateBlock("2026-07-28", {
    providers: [{ provider: "claude", versions: [{ version: "1.0.0", body: ["- Note."] }] }],
  }));

  const result = runChecker(root, base, changelog);

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

  const result = runChecker(root, base, "");

  assert.equal(result.status, 1);
  assert.match(result.output, /plugins\/claude\/itixo\/\.claude-plugin\/plugin\.json: version 0\.6\.0 must be greater/);
  assert.doesNotMatch(result.output, /Plugin 'itixo' was deleted/);
}));

test("policy checker accepts another nested plugin with strict version and matching heading", () => withRepository((root) => {
  fs.writeFileSync(path.join(root, "README.md"), "baseline\n");
  const base = commit(root, "baseline");
  writeJson(root, "plugins/codex/second/.claude-plugin/plugin.json", plugin("second", "0.1.0"));
  commit(root, "add plugin");
  const changelog = doc(dateBlock("2026-07-28", {
    providers: [{ provider: "codex", versions: [{ version: "0.1.0", body: ["- New plugin."] }] }],
  }));

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 0, result.output);
}));

test("policy checker explicitly skips fully deleted plugins", () => withRepository((root) => {
  writeBaselinePlugin(root);
  const base = commit(root, "baseline");
  fs.rmSync(path.join(root, "plugins/claude/itixo"), { recursive: true, force: true });
  commit(root, "delete plugin");

  const result = runChecker(root, base, "");

  assert.equal(result.status, 0, result.output);
  assert.match(result.stdout, /Plugin 'claude\/itixo' was deleted; no HEAD manifest to validate/);
}));

test("policy checker allows historical releases for providers no longer present", () => withRepository((root) => {
  writeBaselinePlugins(root, [["claude", "1.0.0"], ["codex", "9.0.0"]]);
  const base = commit(root, "baseline");
  writeJson(root, "plugins/claude/itixo/.claude-plugin/plugin.json", plugin("itixo", "1.0.1"));
  fs.rmSync(path.join(root, "plugins/codex/itixo"), { recursive: true, force: true });
  commit(root, "bump claude and retire codex");
  const changelog = doc(
    dateBlock("2026-07-28", {
      providers: [{ provider: "claude", versions: [{ version: "1.0.1", body: ["- Current release."] }] }],
    }),
    dateBlock("2026-07-20", {
      providers: [
        { provider: "codex", versions: [{ version: "9.0.0", body: ["- Historical release for retired plugin."] }] },
        { provider: "copilot", versions: [{ version: "0.1.0", body: ["- Historical release, provider never installed."] }] },
      ],
    }),
  );

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 0, result.output);
  assert.match(result.stdout, /Plugin 'codex\/itixo' was deleted/);
}));

test("policy checker rejects a malformed date heading", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = "## 2026/07/28\n\n### claude\n\n#### 1.0.1\n\n- Fix.\n";

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 1);
  assert.match(result.output, /date heading must be exactly '## YYYY-MM-DD' with a real calendar date; got/);
}));

test("policy checker rejects a date heading with an invalid calendar date", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = "## 2026-02-30\n\n### claude\n\n#### 1.0.1\n\n- Fix.\n";

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 1);
  assert.match(result.output, /date heading must be exactly '## YYYY-MM-DD' with a real calendar date; got/);
}));

test("policy checker rejects a duplicate date section", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = doc(
    dateBlock("2026-07-28", { providers: [{ provider: "claude", versions: [{ version: "1.0.1", body: ["- Fix."] }] }] }),
    dateBlock("2026-07-28", { providers: [{ provider: "claude", versions: [{ version: "1.0.0", body: ["- Old."] }] }] }),
  );

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 1);
  assert.match(result.output, /duplicate date section '## 2026-07-28'; each date may appear once\./);
}));

test("policy checker rejects date sections that are not strictly descending", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = doc(
    dateBlock("2026-07-20", { providers: [{ provider: "claude", versions: [{ version: "1.0.1", body: ["- Fix."] }] }] }),
    dateBlock("2026-07-28", { providers: [{ provider: "claude", versions: [{ version: "1.0.0", body: ["- Old."] }] }] }),
  );

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 1);
  assert.match(result.output, /date sections must be strictly descending; '2026-07-28' must be earlier than '2026-07-20'\./);
}));

test("policy checker rejects a malformed provider heading", () => withRepository((root) => {
  const base = setupBumpedClaude(root);

  for (const headingLine of ["### claude extra", "###claude"]) {
    const changelog = `## 2026-07-28\n\n${headingLine}\n\n#### 1.0.1\n\n- Fix.\n`;
    const result = runChecker(root, base, changelog);
    assert.equal(result.status, 1, headingLine);
    assert.match(result.output, /provider heading must be exactly '### <provider>'; got/, headingLine);
  }
}));

test("policy checker rejects an unknown provider heading", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = "## 2026-07-28\n\n### gitlab\n\n#### 1.0.1\n\n- Fix.\n";

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 1);
  assert.match(result.output, /unknown provider 'gitlab' in provider heading; must be one of claude, codex, copilot\./);
}));

test("policy checker rejects a duplicate provider heading within a date section", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = "## 2026-07-28\n\n### claude\n\n#### 1.0.1\n\n- First.\n\n### claude\n\n#### 1.0.0\n\n- Duplicate.\n";

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 1);
  assert.match(result.output, /duplicate provider heading '### claude' in date section '2026-07-28'\./);
}));

test("policy checker rejects providers out of order within a date section", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = doc(dateBlock("2026-07-28", {
    providers: [
      { provider: "codex", versions: [{ version: "0.1.0", body: ["- Codex first."] }] },
      { provider: "claude", versions: [{ version: "1.0.1", body: ["- Claude second."] }] },
    ],
  }));

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 1);
  assert.match(result.output, /providers within date section '2026-07-28' must appear in order claude, codex, copilot; 'claude' is out of order\./);
}));

test("policy checker rejects a provider heading with no version headings", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = "## 2026-07-28\n\n### claude\n\n### codex\n\n#### 1.0.0\n\n- Codex fix.\n";

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 1);
  assert.match(result.output, /provider section '### claude' must contain at least one version heading\./);
}));

test("policy checker rejects a provider heading with no version headings when the date section ends", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = "## 2026-07-28\n\n- Common bullet.\n\n### claude\n\n## 2026-07-20\n\n### claude\n\n#### 1.0.1\n\n- Fix.\n";

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 1);
  assert.match(result.output, /provider section '### claude' must contain at least one version heading\./);
}));

test("policy checker rejects a provider heading with no version headings at end of file", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = "## 2026-07-28\n\n### claude\n\n#### 1.0.1\n\n- Fix.\n\n## 2026-07-20\n\n- Common bullet.\n\n### claude\n";

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 1);
  assert.match(result.output, /provider section '### claude' must contain at least one version heading\./);
}));

test("policy checker rejects content between a provider heading and its first version heading", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = "## 2026-07-28\n\n### claude\n\nNot allowed here.\n\n#### 1.0.1\n\n- Fix.\n";

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 1);
  assert.match(result.output, /content between '### claude' and its first '#### <version>' heading is not allowed; got "Not allowed here\."\./);
}));

test("policy checker rejects a malformed version heading", () => withRepository((root) => {
  const base = setupBumpedClaude(root);

  for (const headingLine of ["#### 1.0.1-beta", "#### 1.0.1 extra"]) {
    const changelog = `## 2026-07-28\n\n### claude\n\n${headingLine}\n\n- Fix.\n`;
    const result = runChecker(root, base, changelog);
    assert.equal(result.status, 1, headingLine);
    assert.match(result.output, /version heading must be exactly '#### MAJOR\.MINOR\.PATCH'; got/, headingLine);
  }
}));

test("policy checker rejects a duplicate version heading", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = doc(dateBlock("2026-07-28", {
    providers: [{
      provider: "claude",
      versions: [
        { version: "1.0.1", body: ["- First."] },
        { version: "1.0.1", body: ["- Duplicate."] },
      ],
    }],
  }));

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 1);
  assert.match(result.output, /duplicate version heading '#### 1\.0\.1' under '### claude'; each version may appear at most once per provider\./);
}));

test("policy checker rejects versions that do not strictly descend under a provider", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = doc(dateBlock("2026-07-28", {
    providers: [{
      provider: "claude",
      versions: [
        { version: "1.0.0", body: ["- Older first."] },
        { version: "1.0.1", body: ["- Newer second."] },
      ],
    }],
  }));

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 1);
  assert.match(result.output, /versions under provider 'claude' must be strictly descending; '1\.0\.1' must be lower than '1\.0\.0'\./);
}));

test("policy checker rejects versions that do not strictly descend for a provider across date sections", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = doc(
    dateBlock("2026-07-28", { providers: [{ provider: "claude", versions: [{ version: "1.0.0", body: ["- Newer date, lower version."] }] }] }),
    dateBlock("2026-07-20", { providers: [{ provider: "claude", versions: [{ version: "1.0.1", body: ["- Older date, higher version."] }] }] }),
  );

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 1);
  assert.match(result.output, /versions under provider 'claude' must be strictly descending; '1\.0\.1' must be lower than '1\.0\.0'\./);
}));

test("policy checker rejects a date section with no provider heading", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = "## 2026-07-28\n\n- Just a common bullet, no provider.\n";

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 1);
  assert.match(result.output, /date section '2026-07-28' must contain at least one provider heading\./);
}));

test("policy checker rejects a date section with no visible content", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = "## 2026-07-28\n\n### claude\n\n#### 1.0.1\n\n";

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 1);
  assert.match(result.output, /date section '2026-07-28' must have visible content: common bullets or a version body\./);
}));

test("policy checker rejects malformed bullet lines in a common section", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = "## 2026-07-28\n\nNot a bullet line.\n\n### claude\n\n#### 1.0.1\n\n- Fix.\n";

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 1);
  assert.match(result.output, /common section for date '2026-07-28' must be '- ' bullet lines; got "Not a bullet line\."\./);
}));

test("policy checker rejects malformed bullet lines in a version body", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = "## 2026-07-28\n\n### claude\n\n#### 1.0.1\n\nNot a bullet line.\n";

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 1);
  assert.match(result.output, /version body for '#### 1\.0\.1' under '### claude' must be '- ' bullet lines; got "Not a bullet line\."\./);
}));

test("policy checker rejects an orphan provider heading before any date section", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = "### claude\n\n#### 1.0.1\n\n- Fix.\n\n## 2026-07-28\n\n- Common bullet.\n\n### claude\n\n#### 1.0.0\n\n- Old.\n";

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 1);
  assert.match(result.output, /provider heading '### claude' is an orphan; it must follow a date section, and the first heading in the file must be a date section\./);
}));

test("policy checker rejects an orphan version heading before any provider heading", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = "#### 1.0.1\n\n- Fix.\n\n## 2026-07-28\n\n### claude\n\n#### 1.0.0\n\n- Old.\n";

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 1);
  assert.match(result.output, /version heading '#### 1\.0\.1' is an orphan; it must follow a provider heading\./);
}));

test("policy checker rejects a plugin directory with an unmapped provider", () => withRepository((root) => {
  writeBaselinePlugin(root, "not-itixo-prefixed", "1.0.0");
  const base = commit(root, "baseline");
  writeJson(root, "plugins/not-itixo-prefixed/itixo/.claude-plugin/plugin.json", plugin("itixo", "1.0.1"));
  commit(root, "bump plugin");
  const changelog = doc(dateBlock("2026-07-28", {
    providers: [{ provider: "claude", versions: [{ version: "1.0.1", body: ["- Fix."] }] }],
  }));

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 1);
  assert.match(result.output, /plugins\/not-itixo-prefixed\/itixo: unknown provider; add it to PROVIDERS in scripts\/providers\.js\./);
}));

test("policy checker accepts a bodyless version when the date has common bullets", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = "## 2026-07-28\n\n- Common bullet covers this date.\n\n### claude\n\n#### 1.0.1\n\n";

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 0, result.output);
}));

test("policy checker does not enforce bullet formatting inside fenced code blocks", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = [
    "## 2026-07-28",
    "",
    "### claude",
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

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 0, result.output);
}));

test("policy checker rejects a version body that is only an empty fence", () => withRepository((root) => {
  const base = setupBumpedClaude(root);
  const changelog = [
    "## 2026-07-28",
    "",
    "### claude",
    "",
    "#### 1.0.1",
    "",
    "```",
    "```",
    "",
  ].join("\n");

  const result = runChecker(root, base, changelog);

  assert.equal(result.status, 1);
  assert.match(result.output, /date section '2026-07-28' must have visible content/);
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
