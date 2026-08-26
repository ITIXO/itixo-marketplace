#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { PROVIDERS } = require("./providers");

const MARKETPLACE_FILES = [
  ".claude-plugin/marketplace.json",
  ".agents/plugins/marketplace.json",
  ".github/plugin/marketplace.json",
];
const PLUGIN_MANIFESTS = [
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  "plugin.json",
];
const RELOCATABLE_TEXT_EXTENSIONS = new Set([".json", ".js", ".md", ".toml", ".yaml"]);
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option !== "--base" && option !== "--changelog-dir") {
      throw new Error(`Unknown option: ${option}`);
    }
    if (options[option]) throw new Error(`Duplicate option: ${option}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${option}`);
    options[option] = value;
    index += 1;
  }
  if (!options["--base"] || !options["--changelog-dir"]) {
    throw new Error("Usage: node scripts/validate-plugin-changes.js --base <commit> --changelog-dir <path>");
  }
  return { base: options["--base"], changelogDir: options["--changelog-dir"] };
}

function git(args, options = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function gitBuffer(args) {
  try {
    return execFileSync("git", args, {
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
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
  const source = pluginSourcePath(plugin);
  const sourceMatch = /^(?:\.\/)?plugins\/([^/]+)\/([^/]+)\/?$/.exec(source);
  if (sourceMatch) return `${sourceMatch[1]}/${sourceMatch[2]}`;
  const legacyMatch = /^(?:\.\/)?plugins\/itixo-([^/]+)\/?$/.exec(source);
  return legacyMatch ? `${legacyMatch[1]}/itixo` : plugin?.name;
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
  return new Set(files.map((file) => {
    const legacyMatch = /^plugins\/itixo-([^/]+)\//.exec(file);
    if (legacyMatch) return `${legacyMatch[1]}/itixo`;
    const sourceMatch = /^plugins\/([^/]+)\/([^/]+)\//.exec(file);
    return sourceMatch ? `${sourceMatch[1]}/${sourceMatch[2]}` : null;
  }).filter(Boolean));
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

function checkBulletLines(entries, errors, filename, contextLabel) {
  for (const entry of entries) {
    if (entry.inFence) continue;
    if (entry.line.trim() === "") continue;
    if (!/^- \S/.test(entry.line)) {
      errors.push(`${filename}:${entry.lineNumber}: ${contextLabel} must be '- ' bullet lines; got ${JSON.stringify(entry.line)}.`);
    }
  }
}

function parseChangelog(markdown, filename) {
  const errors = [];
  const headings = new Set();
  const visibleMarkdown = String(markdown).replace(
    /<!--[\s\S]*?(?:-->|$)/g,
    (comment) => comment.replace(/[^\n]/g, " "),
  );
  const lines = visibleMarkdown.split(/\r?\n/);

  let fence = null;
  let currentDate = null;
  let currentVersion = null;
  let dateBuffer = [];
  let lastDateSeen = null;
  let lastVersionGlobal = null;
  const seenVersions = new Set();

  const pushLine = (line, lineNumber, entryInFence, isFenceDelimiter) => {
    const entry = { line, lineNumber, inFence: entryInFence, isFenceDelimiter };
    if (currentVersion) {
      currentVersion.body.push(entry);
    } else if (currentDate && !currentDate.hasFirstVersion) {
      dateBuffer.push(entry);
    }
  };

  const finishVersion = () => {
    if (!currentVersion) return;
    const nonBlank = currentVersion.body.filter((entry) => entry.line.trim() !== "" && !entry.isFenceDelimiter);
    if (nonBlank.length > 0) {
      checkBulletLines(currentVersion.body, errors, filename, `version body for '#### ${currentVersion.version}'`);
    }
    const bulletLines = currentVersion.body.filter(
      (entry) => !entry.inFence && entry.line.trim() !== "" && /^- \S/.test(entry.line),
    );
    if (bulletLines.length === 0) {
      errors.push(`${filename}:${currentVersion.line}: version '#### ${currentVersion.version}' must have at least one '- ' bullet line.`);
    }
    currentVersion = null;
  };

  const finishDateBuffer = () => {
    const nonBlank = dateBuffer.filter((entry) => entry.line.trim() !== "" && !entry.isFenceDelimiter);
    if (nonBlank.length > 0) {
      const first = nonBlank[0];
      errors.push(`${filename}:${first.lineNumber}: content between '### ${currentDate.date}' and its first '#### <version>' heading is not allowed; got ${JSON.stringify(first.line)}.`);
    }
    dateBuffer = [];
  };

  const finishDate = () => {
    if (!currentDate) return;
    finishVersion();
    if (!currentDate.hasFirstVersion) {
      finishDateBuffer();
      errors.push(`${filename}:${currentDate.line}: date section '${currentDate.date}' must contain at least one version heading.`);
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

    const h1 = /^#(?!#)(.*)$/.exec(line);
    if (h1) {
      errors.push(`${filename}:${lineNumber}: only '### YYYY-MM-DD' and '#### MAJOR.MINOR.PATCH' headings are allowed; got ${JSON.stringify(line)}.`);
      continue;
    }

    const h2 = /^##(?!#)(.*)$/.exec(line);
    if (h2) {
      errors.push(`${filename}:${lineNumber}: only '### YYYY-MM-DD' and '#### MAJOR.MINOR.PATCH' headings are allowed; got ${JSON.stringify(line)}.`);
      continue;
    }

    const h3 = /^###(?!#)(.*)$/.exec(line);
    if (h3) {
      finishDate();
      const heading = h3[1];
      const dateMatch = /^ (\d{4}-\d{2}-\d{2})$/.exec(heading);
      const dateString = dateMatch?.[1];
      if (!dateMatch || !isValidCalendarDate(dateString)) {
        errors.push(`${filename}:${lineNumber}: date heading must be exactly '### YYYY-MM-DD' with a real calendar date; got ${JSON.stringify(line)}.`);
        currentDate = null;
        currentVersion = null;
        dateBuffer = [];
        continue;
      }
      if (lastDateSeen !== null) {
        if (dateString === lastDateSeen) {
          errors.push(`${filename}:${lineNumber}: duplicate date section '### ${dateString}'; each date may appear once.`);
        } else if (dateString > lastDateSeen) {
          errors.push(`${filename}:${lineNumber}: date sections must be strictly descending; '${dateString}' must be earlier than '${lastDateSeen}'.`);
        }
      }
      lastDateSeen = dateString;
      currentDate = { date: dateString, line: lineNumber, hasFirstVersion: false };
      currentVersion = null;
      dateBuffer = [];
      continue;
    }

    const h4 = /^####(?!#)(.*)$/.exec(line);
    if (h4) {
      finishVersion();
      if (!currentDate) {
        errors.push(`${filename}:${lineNumber}: version heading '####${h4[1]}' is an orphan; it must follow a date heading.`);
        continue;
      }
      const versionMatch = /^ ((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(h4[1]);
      if (!versionMatch) {
        errors.push(`${filename}:${lineNumber}: version heading must be exactly '#### MAJOR.MINOR.PATCH'; got ${JSON.stringify(line)}.`);
        continue;
      }
      const [, version] = versionMatch;
      if (!currentDate.hasFirstVersion) {
        finishDateBuffer();
        currentDate.hasFirstVersion = true;
      }
      if (seenVersions.has(version)) {
        errors.push(`${filename}:${lineNumber}: duplicate version heading '#### ${version}'; each version may appear at most once.`);
      } else {
        seenVersions.add(version);
        headings.add(version);
        if (lastVersionGlobal && compareVersions(lastVersionGlobal, version) <= 0) {
          errors.push(`${filename}:${lineNumber}: versions must be strictly descending; '${version}' must be lower than '${lastVersionGlobal}'.`);
        }
        lastVersionGlobal = version;
      }

      currentVersion = { version, line: lineNumber, body: [] };
      continue;
    }

    pushLine(line, lineNumber, false);
  }
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

function pluginExistsAtBase(base, pluginDir) {
  try {
    git(["cat-file", "-e", `${base}:${pluginDir}`]);
    return true;
  } catch {
    return false;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function migrationContent(content, relativePath, provider, name) {
  if (!RELOCATABLE_TEXT_EXTENSIONS.has(path.posix.extname(relativePath))) return null;
  const text = content.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(content)) return null;
  const legacyPath = `plugins/${name}-${provider}`;
  const nestedPath = `plugins/${provider}/${name}`;
  return text
    .replace(new RegExp(`${escapeRegExp(legacyPath)}(?=$|[\\s/"'.,;:!?)}\\]\\x60])`, "g"), nestedPath);
}

function normalizedMarketplace(manifest) {
  if (!manifest || !Array.isArray(manifest.plugins)) return manifest;
  const normalizeSource = (source) => {
    const match = /^(\.\/)?plugins\/([^/]+)\/([^/]+)\/?$/.exec(source);
    if (match) return `${match[1] ?? ""}plugins/${match[3]}-${match[2]}`;
    return source;
  };
  return {
    ...manifest,
    plugins: manifest.plugins.map((plugin) => {
      if (!plugin || typeof plugin !== "object") return plugin;
      if (typeof plugin.source === "string") return { ...plugin, source: normalizeSource(plugin.source) };
      if (plugin.source && typeof plugin.source === "object") {
        return { ...plugin, source: { ...plugin.source, path: normalizeSource(plugin.source.path) } };
      }
      return plugin;
    }),
  };
}

function hasOnlyMarketplaceRelocation(base) {
  return MARKETPLACE_FILES.every((marketplacePath) => {
    const previous = readBaseJson(base, marketplacePath);
    const current = fs.existsSync(marketplacePath) ? readJson(marketplacePath) : null;
    return stableJson(previous) === stableJson(normalizedMarketplace(current));
  });
}

function isPureLegacyRelocation(base, legacyPluginDir, pluginDir, provider, name) {
  if (!pluginExistsAtBase(base, legacyPluginDir) || pluginExistsAtBase("HEAD", legacyPluginDir)) return false;
  if (!hasOnlyMarketplaceRelocation(base)) return false;
  const baseFiles = git(["ls-tree", "-r", "--name-only", base, "--", legacyPluginDir]).split("\n").filter(Boolean);
  const headFiles = git(["ls-tree", "-r", "--name-only", "HEAD", "--", pluginDir]).split("\n").filter(Boolean);
  const baseByRelativePath = new Map(baseFiles.map((file) => [file.slice(legacyPluginDir.length + 1), file]));
  const headByRelativePath = new Map(headFiles.map((file) => [file.slice(pluginDir.length + 1), file]));
  if (baseByRelativePath.size !== headByRelativePath.size) return false;

  for (const [relativePath, baseFile] of baseByRelativePath) {
    const headFile = headByRelativePath.get(relativePath);
    if (!headFile) return false;
    if (git(["ls-tree", "--format=%(objectmode) %(objecttype)", base, "--", baseFile])
      !== git(["ls-tree", "--format=%(objectmode) %(objecttype)", "HEAD", "--", headFile])) return false;
    const baseContent = gitBuffer(["show", `${base}:${baseFile}`]);
    const headContent = gitBuffer(["show", `HEAD:${headFile}`]);
    if (!baseContent || !headContent) return false;
    const normalizedBase = migrationContent(baseContent, relativePath, provider, name);
    if (normalizedBase === null) {
      if (!baseContent.equals(headContent)) return false;
    } else if (!Buffer.from(normalizedBase).equals(headContent)) return false;
  }
  return true;
}

function validatePlugin(base, changelogHeadingsMap, key) {
  const pluginMatch = /^([^/]+)\/([^/]+)$/.exec(key);
  if (!pluginMatch) {
    return { errors: [`plugins/${key}: unknown plugin layout; expected plugins/<provider>/<plugin>.`], skipped: null };
  }
  const [, provider, name] = pluginMatch;
  if (!PROVIDERS.includes(provider)) {
    return { errors: [`plugins/${provider}/${name}: unknown provider; add it to PROVIDERS in scripts/providers.js.`], skipped: null };
  }

  const pluginDir = path.join("plugins", provider, name);
  if (!fs.existsSync(pluginDir)) {
    return { errors: [], skipped: `Plugin '${provider}/${name}' was deleted; no HEAD manifest to validate.` };
  }

  const errors = [];
  const legacyPluginDir = path.join("plugins", `${name}-${provider}`);
  const basePluginDir = pluginExistsAtBase(base, pluginDir)
    ? pluginDir
    : (pluginExistsAtBase(base, legacyPluginDir) ? legacyPluginDir : null);
  const isNewPlugin = basePluginDir === null;
  const relocatedFromLegacyLayout = basePluginDir === legacyPluginDir;
  const pureLegacyRelocation = relocatedFromLegacyLayout
    && isPureLegacyRelocation(base, legacyPluginDir, pluginDir, provider, name);
  const baseManifests = new Map();
  const baseVersions = [];
  if (!isNewPlugin) {
    for (const manifestRelativePath of PLUGIN_MANIFESTS) {
      const manifestLabel = path.posix.join(basePluginDir, manifestRelativePath);
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
      errors.push(`${basePluginDir}: existing base plugin has no valid release manifest; cannot validate version bump.`);
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
    if (requiredBase && !pureLegacyRelocation && !isGreaterVersion(version, requiredBase.version)) {
      const context = requiredBase.kind === "same-provider"
        ? `same-provider base version ${requiredBase.version}`
        : `highest base plugin version ${requiredBase.version} after provider replacement`;
      errors.push(`${manifestLabel}: version ${version} must be greater than ${context}.`);
    }
  }

  if (versions.length === 0) errors.push(`${pluginDir}: no plugin manifest exists at HEAD.`);
  if (!pureLegacyRelocation) {
    const headings = changelogHeadingsMap.get(provider);
    if (headings) {
      for (const version of new Set(versions)) {
        if (!headings.has(version)) {
          errors.push(`changelog.${provider}.md: missing heading '#### ${version}'.`);
        }
      }
    }
  }
  return { errors, skipped: null };
}

function validatePluginChanges({ base, changelogDir }) {
  const changedPlugins = new Set([...changedPluginPaths(base), ...changedMarketplacePlugins(base)]);
  if (changedPlugins.size === 0) return { errors: [], skipped: [] };

  const errors = [];
  const changelogHeadingsMap = new Map();
  for (const provider of PROVIDERS) {
    const filename = `changelog.${provider}.md`;
    const changelogPath = path.join(changelogDir, filename);
    if (!fs.existsSync(changelogPath)) {
      errors.push(`Changelog not found: ${changelogPath}`);
      changelogHeadingsMap.set(provider, null);
      continue;
    }
    const changelog = parseChangelog(fs.readFileSync(changelogPath, "utf8"), filename);
    errors.push(...changelog.errors);
    changelogHeadingsMap.set(provider, changelog.headings);
  }

  const skipped = [];
  for (const name of [...changedPlugins].sort()) {
    const result = validatePlugin(base, changelogHeadingsMap, name);
    errors.push(...result.errors);
    if (result.skipped) skipped.push(result.skipped);
  }
  return { errors, skipped };
}

function main() {
  try {
    const { base, changelogDir } = parseArgs(process.argv.slice(2));
    git(["cat-file", "-e", `${base}^{commit}`]);
    const result = validatePluginChanges({ base, changelogDir });
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
  gitBuffer,
  highestVersion,
  isGreaterVersion,
  parseArgs,
  parseChangelog,
  parseVersion,
  requiredBaseVersion,
  validatePluginChanges,
};
