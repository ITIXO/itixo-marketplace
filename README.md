# Itixo Marketplace

Marketplace with plugins for Claude (Claude Code / Cowork) and Codex.

## Changelog

See the [full changelog in the project Wiki](https://github.com/ITIXO-Playground/itixo-marketplace/wiki/Changelog).

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
| cheap | haiku | Luna + high (or Terra + low fallback) | itixo-investigator, itixo-docs-updater |

The canonical IDs above are shared by both platforms. Without an explicit override, `itixo-planner` inherits the main task's model and effort and other roles use their tier defaults. The `0.2.0` release renamed the former generic IDs; no aliases are provided.

Claude supports an optional model (`opus|sonnet|haiku|fable|inherit`) and effort (`low|medium|high|xhigh|max`) override for one matching agent invocation. Omitted values keep generated defaults. An explicit Opus override can exceed the caller model.

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

Before using `dirigent`, invoke `itixo-codex:install-agents`. Personal scope installs to `~/.codex/agents/`; project scope installs to `<project-root>/.codex/agents/` and requires an explicit project root. Without overrides, cheap roles use Luna + high, mid roles use Terra + medium, and the planner inherits. Terra + low remains the cheap-role fallback.

Any of the seven agents can instead receive an install-time override with repeatable `--agent-model id=sol|terra|luna` and `--agent-effort id=none|low|medium|high|xhigh|max` options. Model and effort are independent, and each per-agent field wins over the corresponding cheap-tier flag. An explicit planner Sol override can exceed the caller model.

The installer creates or replaces only TOML files with its exact Itixo-managed marker, refuses unmanaged conflicts, and skips unchanged managed files on reinstall. Its sorted summary adds `agent-models=` and `agent-efforts=` only when those overrides were supplied. Start a new task or restart Codex after installation so custom agents are discovered. Provider or organization restrictions may constrain available overrides.

## Adding a new plugin

1. Create `plugins/<name>/.claude-plugin/plugin.json` (Claude) and/or `plugins/<name>/.codex-plugin/plugin.json` (Codex).
2. Add skills/commands/agents as needed.
3. Register Claude plugins in `.claude-plugin/marketplace.json` and Codex plugins in `.agents/plugins/marketplace.json`.
4. If adding or changing shared agent roles, generate committed Claude agents and Codex TOML templates with `node scripts/generate-agents.js`.
5. Run `node scripts/generate-agents.js --check`, `node --test tests/*.test.js`, and `node tests/validate.js`.
