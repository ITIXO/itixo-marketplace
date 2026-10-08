---
name: update-models
description: Check or update installed Itixo Codex agents using the plugin's packaged model catalog and installer. Use for agent model, version, or reasoning-effort changes.
---

# Update installed Itixo Codex agents

Use the installed plugin's files and the user's chosen agent directory. Model choices come from the packaged catalog; apply them through the bundled installer.

## Locate and inspect

1. Resolve `PLUGIN_ROOT` to the absolute directory two levels above this loaded skill's directory. Resolve paths from the skill location, not the current working directory. Read `${PLUGIN_ROOT}/scripts/model-catalog.json`, `${PLUGIN_ROOT}/rules/agents.md`, and `${PLUGIN_ROOT}/skills/install-agents/SKILL.md`; verify `${PLUGIN_ROOT}/scripts/install-agents.js` and `${PLUGIN_ROOT}/templates/agents/` exist. If any packaged dependency is missing, report the incomplete installation and use the host's normal plugin update/reinstall flow before continuing.
2. Collect personal (`~/.codex/agents/`) or project (`<project-root>/.codex/agents/`) scope and an explicit project root when applicable. Honor scope already supplied. If both scopes contain agents, show both and ask which to update. Inspect all eight canonical agents in the chosen scope before replacement. Read model and effort independently, including planner overrides and omitted fields. Report unmanaged files or symbolic links as conflicts; let the installer refuse them. If no managed agents exist, offer installation in the confirmed scope.
3. Present exactly two tables using packaged and installed data:
   - **Level | Current model | Possible options**: include cheap, mid, security, and orchestrator. Use installed values for the current model; if a tier has differing agent values, show them rather than inventing one tier setting. For missing agents, label the packaged default as not installed. List non-pinned Codex aliases with their concrete versions and supported efforts from the catalog, marking defaults. Keep full concrete IDs and pinned compatibility selectors available for explicit overrides. Orchestrator inherits unless the installed planner explicitly overrides it.
   - **Agent name | Level**: use all eight canonical IDs and their mapping in the packaged rules. Show every installed model/effort override or missing field beside its agent; never hide planner overrides behind inheritance.

## Choose and apply

4. Use a questionnaire when available, otherwise ask in text. Offer keeping current values, selecting packaged defaults, or choosing another packaged model/version. Collect tier aliases, one concrete version per distinct alias, efforts, and any per-agent overrides needed for the requested change. Honor explicit choices without asking again. A difference from today's packaged default may be an older default or a deliberate override: ask which affected values to retain instead of guessing intent. Preserve every unselected agent's model and effort independently, including planner inheritance and effort-only overrides. A check/verify request stops after inspection and the tables without updating plugins or agent files.
5. Only offer models and efforts accepted by the packaged installer. If a requested model is absent, use the host's normal update flow for this Itixo plugin when authorized; then rediscover the loaded plugin location and reread its catalog. If it is still absent or updating is unavailable, report that limitation. Keep packaged catalog, templates, and cached instructions read-only; new catalog entries arrive through plugin releases.
6. Show the complete resolved configuration before replacement. Read `${PLUGIN_ROOT}/skills/install-agents/SKILL.md` and invoke `itixo:install-agents` with the confirmed scope, `--tier-model`, `--model-version`, and `--cheap-effort` values. Pass retained or selected `--agent-model` and `--agent-effort` values for each agent whose fields must differ from those tier settings. Use full concrete IDs to preserve pins and `none` to preserve an omitted effort field. Omit planner model/effort flags when it inherits. Preserve an explicit unsupported installed choice by stopping and asking for a supported replacement, not silently dropping it. The installer replaces all eight managed definitions, so supply all retained overrides, not only the changed agent's flags.
7. Run the bundled installer by absolute path from any working directory. Report nonzero exits as failures; do not claim an update after a conflict or validation error. On success, reread the destination files and compare every model and effort with the confirmed configuration. Report installed/skipped paths, resolved values, and any verification gap. Start a new Codex task or restart Codex for custom-agent discovery.

This skill updates local Codex agents only. It does not change marketplace defaults, publish releases, or change the running task's model.
