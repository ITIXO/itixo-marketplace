# Itixo Marketplace

Marketplace with plugins for Claude (Claude Code / Cowork) and Codex.

## Structure

```
.claude-plugin/
  marketplace.json        # Marketplace manifest (list of plugins)
base/                     # Shared source of truth for both orchestration plugins
  rules/agents.md         # Delegation rules + model tier table
  agents/                 # Platform-neutral agent role definitions
plugins/
  example-plugin/         # Template plugin
  itixo-claude/           # Itixo library for Claude users (agents, skills, rules, prompts)
  itixo-codex/            # Itixo library for Codex users (agents, prompts, rules)
```

`itixo-claude` and `itixo-codex` are company-wide libraries — anything useful for Itixo people working with Claude or Codex belongs there. Orchestration below is the first module; more skills/agents/rules will accumulate over time.

## Orchestration concept

Orchestrator (main thread) runs on the model the user selected and does the thinking: decompose, delegate, integrate. Precisely specified steps go to subagents on cheaper models:

| Tier | Claude | Codex | Agents |
|------|--------|-------|--------|
| orchestrator | inherit | user-selected | planner |
| mid | sonnet | gpt-5.6-terra | builder, tester, reviewer |
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

Codex has no marketplace format of its own. Skills in `plugins/*/skills/` are plain Markdown (`SKILL.md`) and can be referenced from `AGENTS.md` or copied into a Codex prompts/instructions folder.

## Adding a new plugin

1. Create `plugins/<name>/.claude-plugin/plugin.json`.
2. Add skills/commands/agents as needed.
3. Register the plugin in `.claude-plugin/marketplace.json` (`plugins` array).
