---
name: install-agents
description: Install Itixo-managed Codex custom-agent TOML files into a personal or project Codex agent directory.
---

# Install Itixo custom agents

Ask user before installation. Do not assume any choice:

1. Scope: personal (`~/.codex/agents/`) or project (`<project-root>/.codex/agents/`).
2. Cheap model: Luna (recommended) or Terra fallback.
3. Cheap effort: high (recommended with Luna) or low (recommended with Terra). Keep this as a separate choice so the user can override the recommendation.
4. Optional per-agent overrides for any of `itixo-planner`, `itixo-builder`, `itixo-github-issues`, `itixo-tester`, `itixo-reviewer`, `itixo-investigator`, and `itixo-docs-updater`. Ask for model and effort separately. Do not invent values for agents the user did not name.

The model and effort flags are independent. All four combinations are supported, including Luna + low and Terra + high.

Repeat `--agent-model id=sol|terra|luna` and `--agent-effort id=none|low|medium|high|xhigh|max` for each requested agent. A per-agent model or effort wins over the corresponding cheap-tier flag. Without per-agent overrides, cheap roles remain Luna + high, mid roles remain Terra + medium, and the planner inherits. An explicit planner Sol override may exceed the caller model, subject to provider or organization restrictions.

After user answers, run exactly one command from plugin root:

```sh
node "${PLUGIN_ROOT}/scripts/install-agents.js" --scope personal --cheap-model luna --cheap-effort high
node "${PLUGIN_ROOT}/scripts/install-agents.js" --scope personal --cheap-model terra --cheap-effort low
node "${PLUGIN_ROOT}/scripts/install-agents.js" --scope personal --cheap-model luna --cheap-effort low
node "${PLUGIN_ROOT}/scripts/install-agents.js" --scope personal --cheap-model terra --cheap-effort high
node "${PLUGIN_ROOT}/scripts/install-agents.js" --scope project --project-root "/absolute/or/resolved/project-root" --cheap-model luna --cheap-effort high
node "${PLUGIN_ROOT}/scripts/install-agents.js" --scope project --project-root "/absolute/or/resolved/project-root" --cheap-model terra --cheap-effort low
node "${PLUGIN_ROOT}/scripts/install-agents.js" --scope project --project-root "/absolute/or/resolved/project-root" --agent-model itixo-planner=sol --agent-effort itixo-planner=max --agent-model itixo-reviewer=luna --agent-effort itixo-reviewer=xhigh
```

Report installed and skipped paths from command output. When overrides are supplied, the summary includes exact `agent-models=` and/or `agent-efforts=` fields with agent IDs sorted lexically; each field is omitted when its override type was not supplied. Never manually copy TOML files or overwrite unmanaged files. Installer only overwrites files carrying its exact Itixo-managed marker.

Codex discovers custom agents when a new task starts. Ask user to restart Codex or begin a new task after successful installation.
