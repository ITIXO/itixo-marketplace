---
name: install-agents
description: Install Itixo-managed Codex custom-agent TOML files into a personal or project Codex agent directory.
---

# Install Itixo custom agents

Ask user before installation. Do not assume either choice:

1. Scope: personal (`~/.codex/agents/`) or project (`<project-root>/.codex/agents/`).
2. Cheap model: Luna default templates or Terra low-effort fallback when Luna workers are unavailable.

After user answers, run exactly one command from plugin root:

```sh
node "${PLUGIN_ROOT}/scripts/install-agents.js" --scope personal
node "${PLUGIN_ROOT}/scripts/install-agents.js" --scope personal --cheap-model terra
node "${PLUGIN_ROOT}/scripts/install-agents.js" --scope project --project-root "/absolute/or/resolved/project-root"
node "${PLUGIN_ROOT}/scripts/install-agents.js" --scope project --project-root "/absolute/or/resolved/project-root" --cheap-model terra
```

Report installed and skipped paths from command output. Never manually copy TOML files or overwrite unmanaged files. Installer only overwrites files carrying its exact Itixo-managed marker.

Codex discovers custom agents when a new task starts. Ask user to restart Codex or begin a new task after successful installation.
