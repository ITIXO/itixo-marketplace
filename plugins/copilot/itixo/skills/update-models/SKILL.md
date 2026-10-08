---
name: update-models
description: Check or update installed Itixo Copilot agent defaults through Copilot's native plugin update flow. Use when checking agent models or getting models from a newer plugin release.
---

# Update installed Itixo Copilot agents

Copilot agents ship with the plugin. Update their released defaults through Copilot's plugin manager and inspect the resulting packaged definitions.

## Inspect the installed plugin

1. Resolve `PLUGIN_ROOT` to the absolute directory two levels above this loaded skill's directory, independent of the working directory. Read `${PLUGIN_ROOT}/plugin.json`, `${PLUGIN_ROOT}/rules/agents.md`, and the eight `${PLUGIN_ROOT}/agents/itixo-*.agent.md` definitions. Report missing files as an incomplete installation. Use packaged rules for the agent-to-level mapping and agent frontmatter for model defaults; the planner inherits unless its definition says otherwise.
2. Run `copilot plugin list --json` to identify the installed `itixo` plugin and its marketplace/source. Use the exact registered identity, adding `@MARKETPLACE` when needed to disambiguate. If more than one installation remains possible, ask which to update. Inspect any accessible native per-agent model overrides and show them separately from packaged defaults; if effective session configuration is unavailable, state that it has not been verified.
3. Present exactly two tables:
   - **Level | Current model | Possible options**: show cheap, mid, security, and orchestrator from the packaged agents. If agents differ within a level, show their individual values. Options are keeping the installed release or updating to the defaults supplied by a newer plugin release; do not invent independently selectable tier versions.
   - **Agent name | Level**: include all eight canonical agents, their packaged defaults, and any known native configuration overrides. Copilot has no packaged effort field.
4. For a check/verify request, stop after inspection without updating the plugin or user configuration. For an update request, honor explicit authorization or collect the keep/update choice through a questionnaire or text. A request for a specific model does not prove that a released plugin provides it.

## Update and verify

5. Run `copilot plugin update NAME` for the exact identified Itixo installation; do not update every installed plugin. A path-sourced local marketplace plugin loads its directory directly: report that its definitions must come from its provider-managed source and a new session, rather than editing them here. If the plugin manager is unavailable or an update fails, report the blocker without claiming success. Keep native configuration overrides unchanged and packaged files read-only except for the provider-managed update.
6. After a successful update, rerun `copilot plugin list --json`. Rediscover the updated plugin's actual directory through its loaded skill/provider context; it may differ from the old path. Reread its manifest, rules, and agent definitions. Report before/after versions and model defaults, unchanged/no-new-release results, and whether the requested model appears. If new files cannot be located, report the provider's update result separately from unverified agent contents. Restart Copilot or begin a new session to load the updated agents; effective session model overrides remain subject to native configuration.

Use [Copilot's official plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference) for command compatibility. Marketplace model additions are a maintainer release task, separate from this installed-plugin workflow.
