---
name: install-agents
description: Install Itixo-managed Codex custom-agent TOML files into a personal or project Codex agent directory.
---

# Install Itixo custom agents

Ask user before installation. Do not assume any choice:

1. Scope: personal (`~/.codex/agents/`) or project (`<project-root>/.codex/agents/`).
2. Cheap model: Luna (recommended) or Terra fallback.
3. Cheap effort: high (recommended with Luna) or low (recommended with Terra). Keep this as a separate choice so the user can override the recommendation.

The model and effort flags are independent. All four combinations are supported, including Luna + low and Terra + high.

After user answers, run exactly one command from plugin root:

```sh
node "${PLUGIN_ROOT}/scripts/install-agents.js" --scope personal --cheap-model luna --cheap-effort high
node "${PLUGIN_ROOT}/scripts/install-agents.js" --scope personal --cheap-model terra --cheap-effort low
node "${PLUGIN_ROOT}/scripts/install-agents.js" --scope personal --cheap-model luna --cheap-effort low
node "${PLUGIN_ROOT}/scripts/install-agents.js" --scope personal --cheap-model terra --cheap-effort high
node "${PLUGIN_ROOT}/scripts/install-agents.js" --scope project --project-root "/absolute/or/resolved/project-root" --cheap-model luna --cheap-effort high
node "${PLUGIN_ROOT}/scripts/install-agents.js" --scope project --project-root "/absolute/or/resolved/project-root" --cheap-model terra --cheap-effort low
```

Report installed and skipped paths from command output. Never manually copy TOML files or overwrite unmanaged files. Installer only overwrites files carrying its exact Itixo-managed marker.

Codex discovers custom agents when a new task starts. Ask user to restart Codex or begin a new task after successful installation.
