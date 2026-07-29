#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { PROVIDERS, pluginDirToProvider } = require("./providers");

const MARKETPLACE_FILES = [
  ".claude-plugin/marketplace.json",
  ".agents/plugins/marketplace.json",
];
const PLUGIN_MANIFESTS = [
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  "plugin.json",
];
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

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

function pluginSourcePath(plugin) {
  if (typeof plugin?.source === "string") return plugin.source;
  if (typeof plugin?.source?.path === "string") return plugin.source.path;
  return null;
}

function pluginEntries(manifest) {
  return new Map((manifest?.plugins ?? [])
    .filter((plugin) => plugin && (pluginSourcePath(plugin) || typeof plugin.name === "string"))
    .map((plugin) => [pluginSourcePath(plugin) ?? plugin.name, plugin]));
}

function pluginNameFromEntry(plugin) {
  const sourceMatch = /^(?:\.\/)?plugins\/([^/]+)\/?$/.exec(pluginSourcePath(plugin));
  return sourceMatch?.[1] ?? plugin?.name;
}

function changedMarketplacePlugins(base) {
  const names = new Set();
  for (const marketplacePath of MARKETPLACE_FILES) {
    const current = fs.existsSync(marketplacePath) ? readJson(marketplacePath) : null;
    const previous = readBaseJson(base, marketplacePath);
    const currentEntries = pluginEntries(current);
    const previousEntries = pluginEntries(previous);
    for (const source of new Set([...currentEntries.keys(), ...previousEntries.keys()])) {
      const currentEntry = currentEntries.get(source);
      const previousEntry = previousEntries.get(source);
      if (stableJson(currentEntry) !== stableJson(previousEntry)) {
        const name = pluginNameFromEntry(currentEntry ?? previousEntry);
        if (typeof name === "string") names.add(name);
      }
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

function isValidCalendarDate(dateString) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function checkBulletLines(entries, errors, contextLabel) {
  for (const entry of entries) {
    if (entry.inFence) continue;
    if (entry.line.trim() === "") continue;
    if (!/^- \S/.test(entry.line)) {
      errors.push(`Changelog:${entry.lineNumber}: ${contextLabel} must be '- ' bullet lines; got ${JSON.stringify(entry.line)}.`);
    }
  }
}

function parseChangelog(markdown) {
  const errors = [];
  const headings = new Set();
  const visibleMarkdown = String(markdown).replace(
    /<!--[\s\S]*?(?:-->|$)/g,
    (comment) => comment.replace(/[^\n]/g, " "),
  );
  const lines = visibleMarkdown.split(/\r?\n/);

  let fence = null;
  let currentDate = null;
  let currentRelease = null;
  let inCommon = false;
  let commonBuffer = [];
  let lastDateSeen = null;
  const providerLastVersionGlobal = new Map();
  const seenVersionProviderPairs = new Set();

  const pushLine = (line, lineNumber, entryInFence, isFenceDelimiter) => {
    if (currentRelease) {
      currentRelease.body.push({ line, lineNumber, inFence: entryInFence, isFenceDelimiter });
    } else if (currentDate && inCommon) {
      commonBuffer.push({ line, lineNumber, inFence: entryInFence, isFenceDelimiter });
    }
  };

  const finishRelease = () => {
    if (!currentRelease) return;
    const nonBlank = currentRelease.body.filter((entry) => entry.line.trim() !== "" && !entry.isFenceDelimiter);
    if (nonBlank.length > 0) {
      checkBulletLines(currentRelease.body, errors, `release body for '${currentRelease.version} - ${currentRelease.provider}'`);
      if (currentDate) currentDate.anyVisibleContent = true;
    }
    currentRelease = null;
  };

  const finishCommon = () => {
    if (!currentDate) return;
    const nonBlank = commonBuffer.filter((entry) => entry.line.trim() !== "" && !entry.isFenceDelimiter);
    if (nonBlank.length > 0) {
      checkBulletLines(commonBuffer, errors, `common section for date '${currentDate.date}'`);
      currentDate.anyVisibleContent = true;
    }
    commonBuffer = [];
    inCommon = false;
  };

  const finishDate = () => {
    if (!currentDate) return;
    if (inCommon) finishCommon();
    if (!currentDate.hasReleaseHeading) {
      errors.push(`Changelog:${currentDate.line}: date section '${currentDate.date}' must contain at least one release heading.`);
    }
    if (!currentDate.anyVisibleContent) {
      errors.push(`Changelog:${currentDate.line}: date section '${currentDate.date}' must have visible content: common bullets or a release body.`);
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      pushLine(line, lineNumber, true, true);
      continue;
    }
    if (fence) {
      pushLine(line, lineNumber, true);
      continue;
    }

    const h2 = /^##(?!#)(.*)$/.exec(line);
    if (h2) {
      finishRelease();
      finishDate();
      const heading = h2[1];
      const dateMatch = /^ (\d{4}-\d{2}-\d{2})$/.exec(heading);
      const dateString = dateMatch?.[1];
      if (!dateMatch || !isValidCalendarDate(dateString)) {
        errors.push(`Changelog:${lineNumber}: date heading must be exactly '## YYYY-MM-DD' with a real calendar date; got ${JSON.stringify(line)}.`);
        currentDate = null;
        inCommon = false;
        commonBuffer = [];
        continue;
      }
      if (lastDateSeen !== null) {
        if (dateString === lastDateSeen) {
          errors.push(`Changelog:${lineNumber}: duplicate date section '## ${dateString}'; each date may appear once.`);
        } else if (dateString > lastDateSeen) {
          errors.push(`Changelog:${lineNumber}: date sections must be strictly descending; '${dateString}' must be earlier than '${lastDateSeen}'.`);
        }
      }
      lastDateSeen = dateString;
      currentDate = {
        date: dateString,
        line: lineNumber,
        hasReleaseHeading: false,
        anyVisibleContent: false,
        currentProvider: null,
        currentProviderIdx: -1,
        seenProviders: new Set(),
      };
      inCommon = true;
      commonBuffer = [];
      continue;
    }

    const h3 = /^###(?!#)(.*)$/.exec(line);
    if (h3) {
      finishRelease();
      if (!currentDate) {
        errors.push(`Changelog:${lineNumber}: release heading '###${h3[1]}' is an orphan; it must follow a date section, and the first heading in the file must be a date section.`);
        continue;
      }
      if (inCommon) finishCommon();
      const releaseMatch = /^ ((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)) - ([a-z]+)$/.exec(h3[1]);
      if (!releaseMatch) {
        errors.push(`Changelog:${lineNumber}: release heading must be exactly '### MAJOR.MINOR.PATCH - provider'; got ${JSON.stringify(line)}.`);
        currentRelease = null;
        continue;
      }
      const [, version, provider] = releaseMatch;
      if (!PROVIDERS.includes(provider)) {
        errors.push(`Changelog:${lineNumber}: unknown provider '${provider}' in release heading; must be one of ${PROVIDERS.join(", ")}.`);
        currentRelease = null;
        continue;
      }
      currentDate.hasReleaseHeading = true;

      const providerIdx = PROVIDERS.indexOf(provider);
      if (currentDate.currentProvider === null) {
        currentDate.currentProvider = provider;
        currentDate.currentProviderIdx = providerIdx;
        currentDate.seenProviders.add(provider);
      } else if (provider !== currentDate.currentProvider) {
        if (currentDate.seenProviders.has(provider)) {
          errors.push(`Changelog:${lineNumber}: releases for provider '${provider}' must be contiguous within date section '${currentDate.date}'.`);
        } else if (providerIdx < currentDate.currentProviderIdx) {
          errors.push(`Changelog:${lineNumber}: providers within date section '${currentDate.date}' must appear in order ${PROVIDERS.join(", ")}; '${provider}' is out of order.`);
        }
        currentDate.currentProvider = provider;
        currentDate.currentProviderIdx = providerIdx;
        currentDate.seenProviders.add(provider);
      }

      const pairKey = `${version} - ${provider}`;
      if (seenVersionProviderPairs.has(pairKey)) {
        errors.push(`Changelog:${lineNumber}: duplicate release heading '### ${pairKey}'; each version may appear at most once per provider.`);
      } else {
        seenVersionProviderPairs.add(pairKey);
        headings.add(pairKey);
        const lastGlobal = providerLastVersionGlobal.get(provider);
        if (lastGlobal && compareVersions(lastGlobal, version) <= 0) {
          errors.push(`Changelog:${lineNumber}: releases for provider '${provider}' must be strictly descending; '${version}' must be lower than '${lastGlobal}'.`);
        }
        providerLastVersionGlobal.set(provider, version);
      }

      currentRelease = { version, provider, line: lineNumber, body: [] };
      continue;
    }

    pushLine(line, lineNumber, false);
  }
  finishRelease();
  finishDate();
  return { headings, errors };
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

function validatePlugin(base, changelogHeadings, name) {
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
  const provider = pluginDirToProvider(name);
  if (!provider) {
    errors.push(`plugins/${name}: unknown provider; add it to PROVIDERS in scripts/providers.js.`);
  } else {
    for (const version of new Set(versions)) {
      if (!changelogHeadings.has(`${version} - ${provider}`)) {
        errors.push(`Changelog: missing heading '### ${version} - ${provider}'.`);
      }
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
    const result = validatePlugin(base, changelog.headings, name);
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
