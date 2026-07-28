# itixo

`itixo` provides plugins for Claude (Claude Code / Cowork), Codex, and Copilot CLI.

## Changelog

See the [full changelog in the project Wiki](https://github.com/ITIXO-Playground/itixo-marketplace/wiki/Changelog).

## Structure

```
.claude-plugin/
  marketplace.json        # Marketplace manifest — Claude Code native, Codex legacy-compatible
.agents/plugins/
  marketplace.json        # Marketplace manifest — Codex native
.github/plugin/
  marketplace.json        # Marketplace manifest — Copilot CLI native
base/                     # Shared source of truth for all orchestration plugins
  rules/agents.md         # Delegation rules + model tier table
  agents/                 # Canonical platform-neutral agent role definitions
plugins/
  itixo-claude/           # itixo library for Claude users (generated agents, skills, rules, prompts)
  itixo-codex/            # itixo library for Codex users (custom-agent templates, installer, skills, prompts, rules)
  itixo-copilot/          # itixo library for Copilot CLI users (generated agents, skills, rules)
scripts/
  generate-agents.js      # Generates Claude agents, Codex TOML templates, and Copilot agents from base/agents
```

`itixo-claude`, `itixo-codex`, and `itixo-copilot` are company-wide libraries — anything useful for Itixo people working with Claude, Codex, or Copilot CLI belongs there. Orchestration below is the first module; more skills/agents/rules will accumulate over time.

All three plugins include `dirigent`, which loads and enforces the plugin's `rules/agents.md` for multi-step orchestration.

## Orchestration concept

Orchestrator (main thread) runs on the model the user selected and does the thinking: decompose, delegate, integrate. Precisely specified steps go to subagents on cheaper models:

| Tier | Claude | Codex | Copilot CLI | Agents |
|------|--------|-------|-------------|--------|
| orchestrator | inherit | user-selected | inherit | itixo-planner |
| mid | sonnet | Terra + medium | claude-sonnet-5 | itixo-builder, itixo-github-issues, itixo-tester, itixo-reviewer |
| cheap | haiku | Luna + high (or Terra + low fallback) | claude-haiku-4.5 | itixo-investigator, itixo-docs-updater |
| security | opus + max | gpt-5.6-sol + max | claude-opus-5 | itixo-security-reviewer |

The eight canonical IDs above are shared by all three platforms. `itixo-planner` inherits the main task's model and effort. The `0.2.0` release renamed the former generic IDs; no aliases are provided.

Claude supports an optional model (`opus|sonnet|haiku|fable|inherit`) and effort (`low|medium|high|xhigh|max`) override for one matching agent invocation. Omitted values keep generated defaults. An explicit Opus override can exceed the caller model.

### Security reviews

Ask in natural language, for example, “Review my current changes for security issues.” The canonical `itixo-security-reviewer` is user-triggered and read-only. Unless a broader scope is explicitly requested, it reviews the current-branch diff from its merge base, staged and unstaged changes, and relevant untracked files. It reports only evidence-backed findings and redacts secrets.

On a pull request, findings are posted inline when they map to changed lines, or as a general comment otherwise. Unresolved Critical or High findings request changes when the provider supports it; otherwise the agent posts a `COMMENT` identified as self-review. A clean review gets a neutral comment. The orchestrator may auto-fix only a localized behavior-preserving issue with no dependency or version update, migration, public API change, auth-policy decision, secret rotation, or architecture change; it delegates the fix and validation, then replies and resolves the finding. Other findings remain for user decision.

## Developing agent roles

`base/agents` is the canonical source for agent roles. Edit those files only; never hand-edit generated Claude agents under `plugins/itixo-claude/agents/` or Codex templates under `plugins/itixo-codex/templates/agents/`. Generate and commit provider copies with:

```
node scripts/generate-agents.js
```

Claude uses the generated native agents directly. Codex templates are inactive inside the plugin: install them explicitly before they can be discovered. Copilot CLI agents (`.agent.md` files) are used directly by the Copilot plugin system. `rules/` and `AGENTS.md` files are maintained separately and are not generated.

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
/plugin install itixo-claude@itixo
```

## Usage (Codex)

Codex (since March 2026) has native plugin/marketplace support:

```
codex plugin marketplace add ITIXO-Playground/itixo-marketplace
```

Then install `itixo-codex` via the `/plugins` browser. It is published only in the native `.agents/plugins/marketplace.json` marketplace; the Claude marketplace publishes only `itixo-claude`.

Before using `dirigent`, invoke `itixo-codex:install-agents`. Personal scope installs to `~/.codex/agents/`; project scope installs to `<project-root>/.codex/agents/` and requires an explicit project root. Without overrides, cheap roles use Luna + high, mid roles use Terra + medium, and the planner inherits. Terra + low remains the cheap-role fallback.

Any of the eight agents can instead receive an install-time override with repeatable `--agent-model id=sol|terra|luna` and `--agent-effort id=none|low|medium|high|xhigh|max` options. Model and effort are independent, and each per-agent field wins over the corresponding cheap-tier flag. An explicit planner Sol override can exceed the caller model.

The installer creates or replaces only TOML files with its exact Itixo-managed marker, refuses unmanaged conflicts, and skips unchanged managed files on reinstall. Its sorted summary adds `agent-models=` and `agent-efforts=` only when those overrides were supplied. Start a new task or restart Codex after installation so custom agents are discovered. Provider or organization restrictions may constrain available overrides.

## Usage (Copilot CLI)

Add this marketplace:

```
copilot plugin marketplace add ITIXO-Playground/itixo-marketplace
```

Install the plugin:

```
copilot plugin install itixo-copilot@itixo
```

Use the `dirigent` skill for multi-step orchestration. It loads and enforces `rules/agents.md`, then delegates each step to the appropriate `itixo-*` agent at the prescribed model tier. Available agents include `itixo-investigator` (haiku, read-only locator), `itixo-builder` (sonnet, implementation), `itixo-tester`, `itixo-reviewer`, `itixo-security-reviewer` (claude-opus-5, read-only security review), `itixo-planner`, `itixo-docs-updater`, and `itixo-github-issues`.

## Adding a new plugin

1. Create `plugins/<name>/.claude-plugin/plugin.json` (Claude), `plugins/<name>/.codex-plugin/plugin.json` (Codex), and/or `plugins/<name>/plugin.json` (Copilot CLI).
2. Add skills/commands/agents as needed.
3. Register Claude plugins in `.claude-plugin/marketplace.json`, Codex plugins in `.agents/plugins/marketplace.json`, and Copilot CLI plugins in `.github/plugin/marketplace.json`.
4. If adding or changing shared agent roles, generate committed Claude agents, Codex TOML templates, and Copilot agents with `node scripts/generate-agents.js`.
5. Run `node scripts/generate-agents.js --check`, `node --test tests/*.test.js`, and `node tests/validate.js`.
