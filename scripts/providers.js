#!/usr/bin/env node
"use strict";

// Single source of truth for provider identity across the marketplace's
// scripts. Adding a provider requires updating PROVIDERS here first, then
// wiring provider-specific data (models, efforts, directories, etc.) into
// each consumer.

const PROVIDERS = Object.freeze(["claude", "codex", "copilot"]);

// Every plugin directory is named `<plugin>-<provider>`: `itixo-claude`,
// `turborepo-codex`. The provider is always the last segment, so the plugin
// name is whatever precedes it and may itself contain dashes.
const PLUGIN_DIR_PATTERN = new RegExp(`^(.+)-(${PROVIDERS.join("|")})$`);

function parsePluginDir(dirName) {
  const match = typeof dirName === "string" ? PLUGIN_DIR_PATTERN.exec(dirName) : null;
  return match ? { plugin: match[1], provider: match[2] } : null;
}

function pluginDirToProvider(dirName) {
  return parsePluginDir(dirName)?.provider ?? null;
}

function pluginDirToName(dirName) {
  return parsePluginDir(dirName)?.plugin ?? null;
}

function pluginDirFor(pluginName, provider) {
  return `${pluginName}-${provider}`;
}

module.exports = {
  PROVIDERS,
  parsePluginDir,
  pluginDirFor,
  pluginDirToName,
  pluginDirToProvider,
};
