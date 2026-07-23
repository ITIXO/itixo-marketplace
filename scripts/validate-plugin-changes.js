#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const MARKETPLACE_FILES = [
  ".claude-plugin/marketplace.json",
  ".agents/plugins/marketplace.json",
];
const PLUGIN_MANIFESTS = [
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
];
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const PLUGIN_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option !== "--base" && option !== "--changelog") {
      throw new Error(`Unknown option: ${option}`);
    }
    if (options[option]) throw new Error(`Duplicate option: ${option}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${option}`);
    options[option] = value;
    index += 1;
  }
  if (!options["--base"] || !options["--changelog"]) {
    throw new Error("Usage: node scripts/validate-plugin-changes.js --base <commit> --changelog <path>");
  }
  return { base: options["--base"], changelog: options["--changelog"] };
}

function git(args, options = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readBaseJson(base, filePath) {
  try {
    return JSON.parse(git(["show", `${base}:${filePath}`]));
  } catch {
    return null;
  }
}

function readBaseManifest(base, filePath) {
  let content;
  try {
    content = git(["show", `${base}:${filePath}`]);
  } catch {
    return { exists: false, manifest: null, error: null };
  }
  try {
    return { exists: true, manifest: JSON.parse(content), error: null };
  } catch (error) {
    return { exists: true, manifest: null, error: error.message };
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function pluginEntries(manifest) {
  return new Map((manifest?.plugins ?? [])
    .filter((plugin) => plugin && typeof plugin.name === "string")
    .map((plugin) => [plugin.name, plugin]));
}

function changedMarketplacePlugins(base) {
  const names = new Set();
  for (const marketplacePath of MARKETPLACE_FILES) {
    const current = fs.existsSync(marketplacePath) ? readJson(marketplacePath) : null;
    const previous = readBaseJson(base, marketplacePath);
    const currentEntries = pluginEntries(current);
    const previousEntries = pluginEntries(previous);
    for (const name of new Set([...currentEntries.keys(), ...previousEntries.keys()])) {
      if (stableJson(currentEntries.get(name)) !== stableJson(previousEntries.get(name))) names.add(name);
    }
  }
  return names;
}

function changedPluginPaths(base) {
  const files = git(["diff", "--name-only", "--find-renames", `${base}...HEAD`]).split("\n").filter(Boolean);
  return new Set(files.map((file) => /^plugins\/([^/]+)\//.exec(file)?.[1]).filter(Boolean));
}

function parseVersion(version) {
  if (typeof version !== "string" || !SEMVER.test(version)) return null;
  return version.split(".").map(Number);
}

function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  if (!leftParts || !rightParts) return null;
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

function parseChangelog(markdown) {
  const sections = new Map();
  const errors = [];
  const visibleMarkdown = String(markdown).replace(
    /<!--[\s\S]*?(?:-->|$)/g,
    (comment) => comment.replace(/[^\n]/g, " "),
  );
  const lines = visibleMarkdown.split(/\r?\n/);
  let currentSection = null;
  let currentRelease = null;
  let fence = null;

  const finishRelease = () => {
    if (!currentRelease) return;
    if (!currentRelease.body.some((line) => line.trim() !== "")) {
      errors.push(`Changelog:${currentRelease.line}: release '${currentRelease.version}' in plugin '${currentSection.slug}' must have visible release notes.`);
    }
    currentRelease = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      if (currentRelease) currentRelease.body.push(line);
      continue;
    }
    if (fence) {
      if (currentRelease) currentRelease.body.push(line);
      continue;
    }

    const h2 = /^##(?!#)(.*)$/.exec(line);
    if (h2) {
      finishRelease();
      const heading = h2[1];
      const slug = heading.startsWith(" ") ? heading.slice(1) : "";
      if (!slug || heading !== ` ${slug}` || !PLUGIN_SLUG.test(slug)) {
        errors.push(`Changelog:${lineNumber}: plugin heading must be exactly '## <lowercase-plugin-slug>'; got ${JSON.stringify(line)}.`);
        currentSection = null;
        continue;
      }
      const section = { slug, line: lineNumber, releases: new Map(), versions: [] };
      if (sections.has(slug)) {
        errors.push(`Changelog:${lineNumber}: duplicate plugin section '## ${slug}'; each plugin may appear once.`);
      } else {
        sections.set(slug, section);
      }
      currentSection = section;
      continue;
    }

    const h3 = /^###(?!#)(.*)$/.exec(line);
    if (h3) {
      finishRelease();
      const releaseMatch = /^ ((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:[ \t].*)?$/.exec(h3[1]);
      if (!releaseMatch) {
        errors.push(`Changelog:${lineNumber}: release heading must start with strict semver as '### MAJOR.MINOR.PATCH' and any suffix must follow whitespace; legacy provider-prefixed or combined headings are not supported.`);
        currentRelease = null;
        continue;
      }
      const version = releaseMatch[1];
      const suffix = h3[1].slice(` ${version}`.length);
      const combinedRelease = /^[ \t]*(?:\/|\+|&|and\b)[ \t]*(?:[a-z0-9]+(?:-[a-z0-9]+)*[ \t]+)?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:[ \t]|$)/i;
      if (combinedRelease.test(suffix)) {
        errors.push(`Changelog:${lineNumber}: combined release heading '${line.trim()}' is not supported; use one release per plugin section.`);
        currentRelease = null;
        continue;
      }
      if (!currentSection) {
        errors.push(`Changelog:${lineNumber}: orphan release heading '### ${version}' must follow an exact plugin section.`);
        currentRelease = null;
        continue;
      }
      if (currentSection.releases.has(version)) {
        errors.push(`Changelog:${lineNumber}: duplicate release '${version}' in plugin '${currentSection.slug}'.`);
      } else {
        const previous = currentSection.versions.at(-1);
        if (previous && compareVersions(previous, version) <= 0) {
          errors.push(`Changelog:${lineNumber}: releases in plugin '${currentSection.slug}' must be strictly descending; '${version}' must be lower than '${previous}'.`);
        }
        const release = { version, line: lineNumber, body: [] };
        currentSection.releases.set(version, release);
        currentSection.versions.push(version);
        currentRelease = release;
      }
      continue;
    }

    if (currentRelease) currentRelease.body.push(line);
  }
  finishRelease();
  return { sections, errors };
}

function highestVersion(versions) {
  return versions.reduce((highest, version) => (
    highest === null || compareVersions(version, highest) > 0 ? version : highest
  ), null);
}

function isGreaterVersion(version, baseVersion) {
  const comparison = compareVersions(version, baseVersion);
  return comparison !== null && comparison > 0;
}

function requiredBaseVersion(baseManifest, highestBaseVersion) {
  if (baseManifest?.exists && !baseManifest.error && parseVersion(baseManifest.manifest?.version)) {
    return { kind: "same-provider", version: baseManifest.manifest.version };
  }
  if (!baseManifest?.exists && highestBaseVersion) {
    return { kind: "replacement-provider", version: highestBaseVersion };
  }
  return null;
}

function pluginExistsAtBase(base, name) {
  try {
    git(["cat-file", "-e", `${base}:plugins/${name}`]);
    return true;
  } catch {
    return false;
  }
}

function validatePlugin(base, changelogSections, name) {
  const pluginDir = path.join("plugins", name);
  if (!fs.existsSync(pluginDir)) {
    return { errors: [], skipped: `Plugin '${name}' was deleted; no HEAD manifest to validate.` };
  }

  const errors = [];
  const isNewPlugin = !pluginExistsAtBase(base, name);
  const baseManifests = new Map();
  const baseVersions = [];
  if (!isNewPlugin) {
    for (const manifestRelativePath of PLUGIN_MANIFESTS) {
      const manifestLabel = path.posix.join(pluginDir, manifestRelativePath);
      const state = readBaseManifest(base, manifestLabel);
      baseManifests.set(manifestRelativePath, state);
      if (!state.exists) continue;
      if (state.error) {
        errors.push(`${base}:${manifestLabel}: invalid JSON; cannot validate version bump (${state.error}).`);
      } else if (!parseVersion(state.manifest?.version)) {
        errors.push(`${base}:${manifestLabel}: base version must be strict MAJOR.MINOR.PATCH; got ${JSON.stringify(state.manifest?.version)}.`);
      } else {
        baseVersions.push(state.manifest.version);
      }
    }
    if (baseVersions.length === 0 && errors.length === 0) {
      errors.push(`plugins/${name}: existing base plugin has no valid release manifest; cannot validate version bump.`);
    }
  }
  const highestBaseVersion = highestVersion(baseVersions);
  const versions = [];
  for (const manifestRelativePath of PLUGIN_MANIFESTS) {
    const manifestPath = path.join(pluginDir, manifestRelativePath);
    if (!fs.existsSync(manifestPath)) continue;
    const manifestLabel = path.posix.join(pluginDir, manifestRelativePath);
    let manifest;
    try {
      manifest = readJson(manifestPath);
    } catch (error) {
      errors.push(`${manifestLabel}: invalid JSON (${error.message})`);
      continue;
    }
    const version = manifest?.version;
    if (!parseVersion(version)) {
      errors.push(`${manifestLabel}: version must be strict MAJOR.MINOR.PATCH; got ${JSON.stringify(version)}.`);
      continue;
    }
    versions.push(version);
    const baseManifest = baseManifests.get(manifestRelativePath);
    const requiredBase = isNewPlugin ? null : requiredBaseVersion(baseManifest, highestBaseVersion);
    if (requiredBase && !isGreaterVersion(version, requiredBase.version)) {
      const context = requiredBase.kind === "same-provider"
        ? `same-provider base version ${requiredBase.version}`
        : `highest base plugin version ${requiredBase.version} after provider replacement`;
      errors.push(`${manifestLabel}: version ${version} must be greater than ${context}.`);
    }
  }

  if (versions.length === 0) errors.push(`plugins/${name}: no plugin manifest exists at HEAD.`);
  for (const version of new Set(versions)) {
    if (!changelogSections.get(name)?.releases.has(version)) {
      errors.push(`Changelog: missing heading '### ${version}' under exact section '## ${name}'.`);
    }
  }
  return { errors, skipped: null };
}

function validatePluginChanges({ base, changelogPath }) {
  const changedPlugins = new Set([...changedPluginPaths(base), ...changedMarketplacePlugins(base)]);
  if (changedPlugins.size === 0) return { errors: [], skipped: [] };
  if (!fs.existsSync(changelogPath)) return { errors: [`Changelog not found: ${changelogPath}`], skipped: [] };

  const changelog = parseChangelog(fs.readFileSync(changelogPath, "utf8"));
  const errors = [...changelog.errors];
  const skipped = [];
  for (const name of [...changedPlugins].sort()) {
    const result = validatePlugin(base, changelog.sections, name);
    errors.push(...result.errors);
    if (result.skipped) skipped.push(result.skipped);
  }
  return { errors, skipped };
}

function main() {
  try {
    const { base, changelog } = parseArgs(process.argv.slice(2));
    git(["cat-file", "-e", `${base}^{commit}`]);
    const result = validatePluginChanges({ base, changelogPath: changelog });
    for (const message of result.skipped) console.log(message);
    if (result.errors.length > 0) {
      console.error("Plugin release policy validation failed:");
      for (const error of result.errors) console.error(`- ${error}`);
      process.exitCode = 1;
      return;
    }
    console.log("Plugin release policy validation passed.");
  } catch (error) {
    console.error(`Plugin release policy validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  changedMarketplacePlugins,
  changedPluginPaths,
  compareVersions,
  highestVersion,
  isGreaterVersion,
  parseArgs,
  parseChangelog,
  parseVersion,
  requiredBaseVersion,
  validatePluginChanges,
};
