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
  agents/                 # Platform-neutral agent role definitions
plugins/
  itixo-claude/           # Itixo library for Claude users (agents, skills, rules, prompts)
  itixo-codex/            # Itixo library for Codex users (agents, skills, prompts, rules)
```

`itixo-claude` and `itixo-codex` are company-wide libraries — anything useful for Itixo people working with Claude or Codex belongs there. Orchestration below is the first module; more skills/agents/rules will accumulate over time.

Both plugins include `dirigent`, which loads and enforces the plugin's `rules/agents.md` for multi-step orchestration.

## Orchestration concept

Orchestrator (main thread) runs on the model the user selected and does the thinking: decompose, delegate, integrate. Precisely specified steps go to subagents on cheaper models:

| Tier | Claude | Codex | Agents |
|------|--------|-------|--------|
| orchestrator | inherit | user-selected | planner |
| mid | sonnet | gpt-5.6-terra | builder, github-issues, tester, reviewer |
| cheap | haiku | gpt-5.6-luna | investigator, docs-updater |

Edit `base/`, then sync changes into both plugins (plugins must stay self-contained — installed plugin does not include `base/`).

## Usage (Claude Code)

Add this marketplace:

```
/plugin marketplace add duchacekjan/itixo-marketplace
```

Install a plugin:

```
/plugin install example-plugin@itixo-marketplace
```

## Usage (Codex)

Codex (since March 2026) has native plugin/marketplace support:

```
codex plugin marketplace add duchacekjan/itixo-marketplace
```

Then install `itixo-codex` via the `/plugins` browser. Codex reads the native manifest at `.agents/plugins/marketplace.json` and also understands `.claude-plugin/marketplace.json` as legacy-compatible. Note: Codex plugins carry skills/hooks/MCP config but cannot define subagents or per-agent models — orchestration works as prompt convention via `AGENTS.md` + `agents/` role files.

## Adding a new plugin

1. Create `plugins/<name>/.claude-plugin/plugin.json` (Claude) and/or `plugins/<name>/.codex-plugin/plugin.json` (Codex).
2. Add skills/commands/agents as needed.
3. Register the plugin in `.claude-plugin/marketplace.json`; Codex-capable plugins also in `.agents/plugins/marketplace.json`.
4. Run `node tests/validate.js`.
