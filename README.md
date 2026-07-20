# Itixo Marketplace

Marketplace with plugins for Claude (Claude Code / Cowork) and Codex.

## Structure

```
.claude-plugin/
  marketplace.json        # Marketplace manifest — Claude Code native, Codex legacy-compatible
.agents/plugins/
  marketplace.json        # Marketplace manifest — Codex native
base/                     # Shared source of truth for both orchestration plugins
  rules/agents.md         # Delegation rules + model tier table
  agents/                 # Canonical platform-neutral agent role definitions
plugins/
  itixo-claude/           # Itixo library for Claude users (generated agents, skills, rules, prompts)
  itixo-codex/            # Itixo library for Codex users (custom-agent templates, installer, skills, prompts, rules)
scripts/
  generate-agents.js      # Generates Claude agents and Codex TOML templates from base/agents
```

`itixo-claude` and `itixo-codex` are company-wide libraries — anything useful for Itixo people working with Claude or Codex belongs there. Orchestration below is the first module; more skills/agents/rules will accumulate over time.

Both plugins include `dirigent`, which loads and enforces the plugin's `rules/agents.md` for multi-step orchestration.

## Orchestration concept

Orchestrator (main thread) runs on the model the user selected and does the thinking: decompose, delegate, integrate. Precisely specified steps go to subagents on cheaper models:

| Tier | Claude | Codex | Agents |
|------|--------|-------|--------|
| orchestrator | inherit | user-selected | itixo-planner |
| mid | sonnet | Terra + medium | itixo-builder, itixo-github-issues, itixo-tester, itixo-reviewer |
| cheap | haiku | Luna + low (or Terra + low fallback) | itixo-investigator, itixo-docs-updater |

The canonical IDs above are shared by both platforms. `itixo-planner` inherits the main task's model and effort. The `0.2.0` release renamed the former generic IDs; no aliases are provided.

## Developing agent roles

`base/agents` is the canonical source for agent roles. Edit those files only; never hand-edit generated Claude agents under `plugins/itixo-claude/agents/` or Codex templates under `plugins/itixo-codex/templates/agents/`. Generate and commit provider copies with:

```
node scripts/generate-agents.js
```

Claude uses the generated native agents directly. Codex templates are inactive inside the plugin: install them explicitly before they can be discovered. `rules/` and `AGENTS.md` files are maintained separately and are not generated.

Before submitting agent changes, verify generated copies and tests:

```
node scripts/generate-agents.js --check
node --test tests/*.test.js
node tests/validate.js
```

## Usage (Claude Code)

Add this marketplace:

```
/plugin marketplace add ITIXO-Playground/itixo-marketplace
```

Install a plugin:

```
/plugin install example-plugin@itixo-marketplace
```

## Usage (Codex)

Codex (since March 2026) has native plugin/marketplace support:

```
codex plugin marketplace add ITIXO-Playground/itixo-marketplace
```

Then install `itixo-codex` via the `/plugins` browser. It is published only in the native `.agents/plugins/marketplace.json` marketplace; the Claude marketplace publishes only `itixo-claude`.

Before using `dirigent`, invoke `itixo-codex:install-agents`. It asks for both required choices: personal scope installs to `~/.codex/agents/`; project scope installs to `<project-root>/.codex/agents/` and requires an explicit project root. Luna + low is the cheap-role default; choose `--cheap-model terra` when Luna workers are unavailable to install Terra + low instead. Mid roles use Terra + medium.

The installer creates or replaces only TOML files with its exact Itixo-managed marker, refuses unmanaged conflicts, and skips unchanged managed files on reinstall. Start a new task or restart Codex after installation so custom agents are discovered.

## Adding a new plugin

1. Create `plugins/<name>/.claude-plugin/plugin.json` (Claude) and/or `plugins/<name>/.codex-plugin/plugin.json` (Codex).
2. Add skills/commands/agents as needed.
3. Register Claude plugins in `.claude-plugin/marketplace.json` and Codex plugins in `.agents/plugins/marketplace.json`.
4. If adding or changing shared agent roles, generate committed Claude agents and Codex TOML templates with `node scripts/generate-agents.js`.
5. Run `node scripts/generate-agents.js --check`, `node --test tests/*.test.js`, and `node tests/validate.js`.
