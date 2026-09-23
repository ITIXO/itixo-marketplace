---
name: install-agents
description: Install Itixo-managed Codex custom-agent TOML files into a personal or project Codex agent directory.
---

# Install Itixo custom agents

Ask user before installation. Do not assume any choice:

1. Scope: personal (`~/.codex/agents/`) or project (`<project-root>/.codex/agents/`).
2. Cheap model: GPT-6 Luna (recommended default), GPT-5.6 Terra fallback, or legacy GPT-5.6 Luna. `gpt6-luna` and `gpt-6-luna` select GPT-6 Luna; `terra` and `luna` retain their GPT-5.6 aliases.
3. Cheap effort: high (recommended with GPT-6 Luna) or low (recommended with GPT-5.6 Terra). Keep this as a separate choice so the user can override the recommendation.
4. Optional per-agent overrides for any of `itixo-planner`, `itixo-builder`, `itixo-github-issues`, `itixo-tester`, `itixo-reviewer`, `itixo-security-reviewer`, `itixo-investigator`, and `itixo-docs-updater`. Ask for model and effort separately. Do not invent values for agents the user did not name.

The model and effort flags are independent. All four cheap-model/effort combinations are supported. Without an override, cheap roles use `gpt-6-luna` with `high`, mid roles use `gpt-6-sol` with `medium`, `itixo-security-reviewer` uses `gpt-6-astra` with `max`, and the planner inherits.

Repeat `--agent-model id=sol|terra|luna|astra|gpt6-sol|gpt6-luna|gpt-6-astra|gpt-6-sol|gpt-6-luna|gpt-5.6-sol|gpt-5.6-terra|gpt-5.6-luna` and `--agent-effort id=none|low|medium|high|xhigh|max|ultra` for each requested agent. Full GPT-6 and GPT-5.6 IDs are accepted. A per-agent model or effort wins over the corresponding cheap-tier flag. `ultra` is unsupported by GPT-6 Luna; `none` clears the effort field and lets the model inherit its provider default. An explicit planner GPT-6 Sol override may exceed the caller model, subject to provider or organization restrictions.

After user answers, run exactly one command from plugin root:

```sh
node "${PLUGIN_ROOT}/scripts/install-agents.js" --scope personal --cheap-model gpt-6-luna --cheap-effort high
node "${PLUGIN_ROOT}/scripts/install-agents.js" --scope personal --cheap-model terra --cheap-effort low
node "${PLUGIN_ROOT}/scripts/install-agents.js" --scope personal --cheap-model gpt6-luna --cheap-effort low
node "${PLUGIN_ROOT}/scripts/install-agents.js" --scope personal --cheap-model terra --cheap-effort high
node "${PLUGIN_ROOT}/scripts/install-agents.js" --scope project --project-root "/absolute/or/resolved/project-root" --cheap-model gpt-6-luna --cheap-effort high
node "${PLUGIN_ROOT}/scripts/install-agents.js" --scope project --project-root "/absolute/or/resolved/project-root" --cheap-model terra --cheap-effort low
node "${PLUGIN_ROOT}/scripts/install-agents.js" --scope project --project-root "/absolute/or/resolved/project-root" --agent-model itixo-planner=gpt6-sol --agent-effort itixo-planner=max --agent-model itixo-reviewer=gpt-5.6-luna --agent-effort itixo-reviewer=xhigh
```

Report installed and skipped paths from command output. When overrides are supplied, the summary includes exact `agent-models=` and/or `agent-efforts=` fields with agent IDs sorted lexically; each field is omitted when its override type was not supplied. Never manually copy TOML files or overwrite unmanaged files. Installer only overwrites files carrying its exact Itixo-managed marker.

Codex discovers custom agents when a new task starts. Ask user to restart Codex or begin a new task after successful installation.
