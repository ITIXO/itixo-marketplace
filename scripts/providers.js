#!/usr/bin/env node
"use strict";

// Single source of truth for provider identity across the marketplace's
// scripts. Adding a provider requires updating PROVIDERS here first, then
// wiring provider-specific data (models, efforts, directories, etc.) into
// each consumer.

const PLUGIN_DIR_PREFIX = "itixo-";

const PROVIDERS = Object.freeze(["claude", "codex", "copilot"]);

function pluginDirToProvider(dirName) {
  if (!dirName.startsWith(PLUGIN_DIR_PREFIX)) return null;
  return PROVIDERS.find((provider) => dirName.endsWith(`-${provider}`)) ?? null;
}

function providerToPluginDir(provider) {
  return `${PLUGIN_DIR_PREFIX}${provider}`;
}

module.exports = {
  PLUGIN_DIR_PREFIX,
  PROVIDERS,
  pluginDirToProvider,
  providerToPluginDir,
};
