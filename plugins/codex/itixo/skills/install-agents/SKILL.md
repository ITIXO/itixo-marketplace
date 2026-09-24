---
name: install-agents
description: Install Itixo-managed Codex custom-agent TOML files into a personal or project Codex agent directory.
---

# Install Itixo custom agents

Read the current `${PLUGIN_ROOT}/scripts/model-catalog.json` before installation. Do not use a stale list of models. Ask user before installation and do not assume any choice:

1. Scope: personal (`~/.codex/agents/`) or project (`<project-root>/.codex/agents/`).
2. For each tier used by the installed agents, choose a catalog alias, preselecting the current `providers.codex.models.<tier>` value. The current catalog preselects `luna` for cheap, `sol` for mid, and `astra` for security; treat those as examples derived from the file, not a static list.
3. For each distinct selected alias, choose its concrete version from that alias's current `versions` list, preselecting its `default`. If the same alias serves multiple tiers, ask for its version once and reuse it. Show the resolved alias → version and effort for cheap, mid, and security.
4. Choose each tier's effort from the current `providers.codex.efforts.<tier>` values, keeping cheap effort as a separate choice. The current catalog preselects `high` for cheap, `medium` for mid, and `max` for security; preserve the existing cheap-effort override behavior.
5. Optional per-agent model and effort overrides for any of `itixo-planner`, `itixo-builder`, `itixo-github-issues`, `itixo-tester`, `itixo-reviewer`, `itixo-security-reviewer`, `itixo-investigator`, and `itixo-docs-updater`. Ask for model and effort separately. Do not invent values for agents the user did not name. If an override selects an alias not used by a tier, include that alias's current version choices as needed.

Tier aliases and concrete versions are independent choices. A tier alias selects the family; its version selects the concrete model ID. Per-agent model and effort overrides have highest precedence independently. `none` clears an effort field and lets the provider default apply. Full concrete IDs pin an agent directly. Legacy `--cheap-model` remains accepted for compatibility with aliases, full IDs, and pinned selectors, but cannot be combined with an explicit `--tier-model cheap=...`.

If the user already supplied an explicit scope, tier alias, version, effort, or per-agent choice, honor it and do not ask for it again.

After user answers, run exactly one command from plugin root. Use repeatable `--tier-model tier=alias` and `--model-version alias=concrete-id` flags, plus `--cheap-effort` and any explicit per-agent overrides:

```sh
node "${PLUGIN_ROOT}/scripts/install-agents.js" --scope personal --tier-model cheap=luna --tier-model mid=sol --tier-model security=astra --model-version luna=gpt-6-luna --model-version sol=gpt-6-sol --model-version astra=gpt-6-astra --cheap-effort high
node "${PLUGIN_ROOT}/scripts/install-agents.js" --scope project --project-root "/absolute/or/resolved/project-root" --tier-model cheap=terra --tier-model mid=sol --tier-model security=astra --model-version terra=gpt-5.6-terra --model-version sol=gpt-5.6-sol --model-version astra=gpt-6-astra --cheap-effort low
node "${PLUGIN_ROOT}/scripts/install-agents.js" --scope project --project-root "/absolute/or/resolved/project-root" --tier-model cheap=luna --tier-model mid=sol --tier-model security=astra --model-version luna=gpt-6-luna --model-version sol=gpt-6-sol --model-version astra=gpt-6-astra --agent-model itixo-planner=gpt6-sol --agent-effort itixo-planner=max --agent-model itixo-reviewer=gpt-5.6-luna --agent-effort itixo-reviewer=xhigh
```

Report installed and skipped paths plus the resolved tier alias/version summary from command output. When per-agent overrides are supplied, the summary includes exact `agent-models=` and/or `agent-efforts=` fields with agent IDs sorted lexically; each field is omitted when its override type was not supplied. Never manually copy TOML files or overwrite unmanaged files. Installer only overwrites files carrying its exact Itixo-managed marker.

Codex discovers custom agents when a new task starts. Ask user to restart Codex or begin a new task after successful installation.
