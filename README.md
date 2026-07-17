# Itixo Marketplace

Marketplace with plugins for Claude (Claude Code / Cowork) and Codex.

## Structure

```
.claude-plugin/
  marketplace.json        # Marketplace manifest (list of plugins)
plugins/
  example-plugin/         # Template plugin
    .claude-plugin/
      plugin.json         # Plugin manifest
    skills/
      example-skill/
        SKILL.md          # Skill definition (usable by Claude and Codex)
    commands/             # Optional slash commands
    agents/               # Optional subagent definitions
```

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
