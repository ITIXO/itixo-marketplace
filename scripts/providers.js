#!/usr/bin/env node
"use strict";

// Single source of truth for provider identity across the marketplace's
// scripts. Adding a provider requires updating PROVIDERS here first, then
// wiring provider-specific data (models, efforts, directories, etc.) into
// each consumer.

const PROVIDERS = Object.freeze(["claude", "codex", "copilot"]);

function pluginDirToProvider(dirName) {
  return PROVIDERS.includes(dirName) ? dirName : null;
}

function providerToPluginDir(provider) {
  return provider;
}

module.exports = {
  PROVIDERS,
  pluginDirToProvider,
  providerToPluginDir,
};
