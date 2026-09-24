# itixo

`itixo` provides plugins for Claude (Claude Code / Cowork), Codex, and Copilot CLI.

## Changelog

See the [full changelog in the project Wiki](https://github.com/ITIXO/itixo-marketplace/wiki/Changelog).

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
  claude/
    itixo/                # itixo library for Claude users (generated agents, skills, rules, prompts)
  codex/
    itixo/                # itixo library for Codex users (custom-agent templates, installer, skills, prompts, rules)
  copilot/
    itixo/                # itixo library for Copilot CLI users (generated agents, skills, rules)
scripts/
  generate-agents.js      # Generates Claude agents, Codex TOML templates, and Copilot agents from base/agents
```

Each provider publishes an `itixo` plugin — Claude, Codex, and Copilot CLI — from its provider-specific source directory. Anything useful for Itixo people working with those providers belongs there. Orchestration below is the first module; more skills/agents/rules will accumulate over time.

All three plugins include `dirigent`, which loads and enforces the plugin's `rules/agents.md` for multi-step orchestration.

## Orchestration concept

Orchestrator (main thread) runs on the model the user selected and does the thinking: decompose, delegate, integrate. Precisely specified steps go to subagents on cheaper models:

| Tier | Claude | Codex | Copilot CLI | Agents |
|------|--------|-------|-------------|--------|
| orchestrator | inherit | user-selected | inherit | itixo-planner |
| mid | sonnet | GPT-6 Sol + medium | claude-sonnet-5 | itixo-builder, itixo-github-issues, itixo-tester, itixo-reviewer |
| cheap | haiku | GPT-6 Luna + high (or GPT-5.6 Terra + low fallback) | claude-haiku-4.5 | itixo-investigator, itixo-docs-updater |
| security | opus + max | GPT-6 Astra + max | claude-opus-5.5 | itixo-security-reviewer |

The eight canonical IDs above are shared by all three platforms. `itixo-planner` inherits the main task's model and effort. The `0.2.0` release renamed the former generic IDs; no agent-ID aliases are provided.

Codex defaults use `gpt-6-sol` for mid-tier agents, `gpt-6-luna` for cheap-tier agents, and `gpt-6-astra` for security review. The installer keeps `sol`, `terra`, and `luna` as GPT-5.6 aliases; `astra`, `gpt6-sol`, and `gpt6-luna` select GPT-6 models, and full GPT-6 and GPT-5.6 IDs are accepted. The cheap default is `gpt-6-luna`; choose `terra` for the GPT-5.6 fallback.

Claude keeps generated defaults unless the user explicitly requests a provider-supported model or effort override. The `opus` alias remains the security default; Claude Code v2.1.280+ resolves it to Opus 5.5 for Anthropic, API, AWS Bedrock, and Google Vertex, while Foundry resolves an older Opus version. See the [official Claude model configuration docs](https://code.claude.com/docs/en/model-config) for provider-specific aliases and restrictions. Pin older Claude choices through the provider's documented model configuration or environment settings.

### Security reviews

Ask in natural language, for example, “Review my current changes for security issues.” The canonical `itixo-security-reviewer` is user-triggered and read-only. Unless a broader scope is explicitly requested, it reviews the current-branch diff from its merge base, staged and unstaged changes, and relevant untracked files. It reports only evidence-backed findings and redacts secrets.

On a pull request, findings are posted inline when they map to changed lines, or as a general comment otherwise. Unresolved Critical or High findings request changes when the provider supports it; otherwise the agent posts a `COMMENT` identified as self-review. A clean review gets a neutral comment. The orchestrator may auto-fix only a localized behavior-preserving issue with no dependency or version update, migration, public API change, auth-policy decision, secret rotation, or architecture change; it delegates the fix and validation, then replies and resolves the finding. Other findings remain for user decision.

## Developing agent roles

`base/agents` is the canonical source for agent roles. Edit those files only; never hand-edit generated Claude agents under `plugins/claude/itixo/agents/` or Codex templates under `plugins/codex/itixo/templates/agents/`. Generate and commit provider copies with:

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
/plugin marketplace add ITIXO/itixo-marketplace
```

Install a plugin:

```
/plugin install itixo@itixo
```

## Usage (Codex)

Codex (since March 2026) has native plugin/marketplace support:

```
codex plugin marketplace add ITIXO/itixo-marketplace
```

Then install `itixo` (Codex plugin) via the `/plugins` browser. It is published only in the native `.agents/plugins/marketplace.json` marketplace; the Claude marketplace publishes only `itixo` (Claude plugin).

Before using `dirigent`, invoke `itixo:install-agents`. Personal scope installs to `~/.codex/agents/`; project scope installs to `<project-root>/.codex/agents/` and requires an explicit project root. Without overrides, cheap roles use GPT-6 Luna + high, mid roles use GPT-6 Sol + medium, security review uses GPT-6 Astra + max, and the planner inherits. GPT-5.6 Terra + low remains the cheap-role fallback.

Any of the eight agents can instead receive an install-time override with repeatable `--agent-model id=sol|terra|luna|astra|gpt6-sol|gpt6-luna|gpt-6-astra|gpt-6-sol|gpt-6-luna|gpt-5.6-sol|gpt-5.6-terra|gpt-5.6-luna` and `--agent-effort id=none|low|medium|high|xhigh|max|ultra` options. Model and effort are independent, and each per-agent field wins over the corresponding cheap-tier flag. `ultra` is unsupported by GPT-6 Luna; `none` clears the effort field and lets the model inherit its provider default. An explicit planner GPT-6 Sol override can exceed the caller model.

The installer creates or replaces only TOML files with its exact Itixo-managed marker, refuses unmanaged conflicts, and skips unchanged managed files on reinstall. Its sorted summary adds `agent-models=` and `agent-efforts=` only when those overrides were supplied. Start a new task or restart Codex after installation so custom agents are discovered. Provider or organization restrictions may constrain available overrides.

To verify or promote supported provider models from the source checkout, invoke `/itixo:update-models`. It checks official model IDs and reasoning efforts, updates the shared catalog, regenerates agent templates, and runs repository validation. Current supported model changes can use `itixo:install-agents`; rerun it for the selected scope and repeat custom overrides because managed files are replaced.

## Usage (Copilot CLI)

Add this marketplace:

```
copilot plugin marketplace add ITIXO/itixo-marketplace
```

Install the plugin:

```
copilot plugin install itixo@itixo
```

Use the `dirigent` skill for multi-step orchestration. It loads and enforces `rules/agents.md`, then delegates each step to the appropriate `itixo-*` agent at the prescribed model tier. Available agents include `itixo-investigator` (haiku, read-only locator), `itixo-builder` (sonnet, implementation), `itixo-tester`, `itixo-reviewer`, `itixo-security-reviewer` (claude-opus-5.5, read-only security review), `itixo-planner`, `itixo-docs-updater`, and `itixo-github-issues`.

## Adding a new plugin

1. Create `plugins/<provider>/<plugin>/.claude-plugin/plugin.json` (Claude), `plugins/<provider>/<plugin>/.codex-plugin/plugin.json` (Codex), and/or `plugins/<provider>/<plugin>/plugin.json` (Copilot CLI).
2. Add skills/commands/agents as needed.
3. Register Claude plugins in `.claude-plugin/marketplace.json`, Codex plugins in `.agents/plugins/marketplace.json`, and Copilot CLI plugins in `.github/plugin/marketplace.json`.
4. If adding or changing shared agent roles, generate committed Claude agents, Codex TOML templates, and Copilot agents with `node scripts/generate-agents.js`.
5. Run `node scripts/generate-agents.js --check`, `node --test tests/*.test.js`, and `node tests/validate.js`.
