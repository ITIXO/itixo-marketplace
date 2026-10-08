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
  rules/agents.md         # Delegation rules
  rules/models.md         # Model tier table + override rules
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

All three plugins include `dirigent`, which loads the plugin's `rules/agents.md` for multi-step orchestration. It is off by default. Provider hooks inject its current state at supported session and agent starts; ordinary coding work, discussion, and quotation do not enable it. Hooks provide instructions, not platform permission controls. Repository instructions still apply when Dirigent is off.

### Dirigent activation

Use slash commands or plain language to change Dirigent's state:

| Request | Effect |
|---|---|
| `/dirigent` or `/dirigent on` — “turn on Dirigent” | Enable for this session; state lasts until changed. |
| `/dirigent off` — “stop Dirigent” | Disable for this session; saved default stays unchanged. |
| `/dirigent on --global` — “turn on Dirigent globally” | Enable now and save opt-in for new sessions across projects in this provider profile. |
| `/dirigent off --global` — “turn off Dirigent for future sessions” | Disable now and remove this provider profile's saved opt-in. |

Equivalent plain-language wording is understood by intent. Global changes affect the current session and future sessions in this provider profile; they do not change other live sessions or providers. Session and saved state live in the provider's writable plugin data, falling back to its configuration directory. If the provider cannot supply hook or control metadata, or storage is unavailable, Dirigent reports that the change could not be saved. It never edits personal instruction files as a fallback.

## Orchestration concept

Orchestrator (main thread) runs on the model the user selected and does the thinking: decompose, delegate, integrate. Precisely specified steps go to subagents on cheaper models; small, clearly specified edits and file or folder scaffolding go to a cheaper junior builder, while anything that needs judgment goes to the regular builder:

| Tier | Claude | Codex | Copilot CLI | Agents |
|------|--------|-------|-------------|--------|
| orchestrator | inherit | user-selected | inherit | itixo-planner |
| mid | sonnet + medium | `sol` → GPT-6.1 Sol + medium | claude-sonnet-5 | itixo-builder, itixo-github-issues, itixo-tester, itixo-reviewer |
| cheap | haiku + medium | `luna` → GPT-6 Luna + high | claude-haiku-5.5 | itixo-investigator, itixo-docs-updater, itixo-junior-builder |
| security | opus + max | `astra` → GPT-6 Astra + max | claude-opus-5.5 | itixo-security-reviewer |

The nine canonical IDs above are shared by all three platforms. `itixo-planner` inherits the main task's model and effort. The `0.2.0` release renamed the former generic IDs; no agent-ID aliases are provided.

The shared catalog defines root aliases such as `sol`, `luna`, `terra`, and `opus`, then records each provider's concrete `default` and `versions` entries. A provider entry is the availability signal, so an alias can work for Claude and Copilot without implying Codex support. Codex assigns its provider aliases to mid, cheap, and security tiers; the installer filters out pinned compatibility aliases, then lets users choose the tier alias and its provider-specific version independently. Legacy selectors such as `gpt6-sol` and `gpt6-luna`, plus full model IDs, remain accepted.

Codex and Copilot each provide `/itixo:update-models` from the installed plugin; no marketplace clone is required. Both show level/current-model/options and agent/level tables. Codex reads its packaged catalog and installed agents, collects confirmed choices, and uses the bundled `itixo:install-agents` installer while preserving unselected model and effort overrides. Copilot updates only the identified Itixo plugin through its native plugin manager and verifies the resulting packaged agent defaults. Check-only requests do not write files. Claude does not package this skill.

Claude keeps generated defaults unless the user explicitly requests a provider-supported model or effort override. The shared catalog's `opus` alias has a Claude provider entry; Claude Code v2.1.280+ resolves it to Opus 5.5 for Anthropic, API, AWS Bedrock, and Google Vertex, while Foundry resolves an older Opus version. See the [official Claude model configuration docs](https://code.claude.com/docs/en/model-config) for provider-specific aliases and restrictions. Pin older Claude choices through the provider's documented model configuration or environment settings.

Claude Code’s `haiku` alias selects Haiku 5.5 on the Anthropic API; other providers may resolve Haiku 4.5. The Claude catalog also retains explicit `claude-haiku-4-5` and adds `claude-haiku-5-5`. Copilot’s `sol` alias now selects `gpt-6.1-sol`, retaining older versions; its `haiku` alias selects `claude-haiku-5.5`, retaining `claude-haiku-4.5` for pinning. See the [Claude model configuration](https://code.claude.com/docs/en/model-config) and [Copilot CLI model reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#supported-models).

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

Before using `dirigent`, invoke `itixo:install-agents`. Personal scope installs to `~/.codex/agents/`; project scope installs to `<project-root>/.codex/agents/` and requires an explicit project root. The skill reads the current catalog, prompts for each tier alias and the concrete version of each selected alias, then shows the resolved cheap, mid, and security settings. Defaults are `luna` → GPT-6 Luna + high, `sol` → GPT-6.1 Sol + medium, `astra` → GPT-6 Astra + max, and the planner inherits. `terra` → GPT-5.6 Terra + low remains the fallback.

Tier choices can be passed with repeatable `--tier-model cheap|mid|security=alias` and `--model-version alias=concrete-id` options. `--cheap-model` remains a compatibility shortcut, but cannot be combined with an explicit cheap tier alias. Any of the nine agents can also receive repeatable `--agent-model id=alias-or-concrete-id` and `--agent-effort id=none|low|medium|high|xhigh|max|ultra` overrides. Model and effort are independent, and per-agent fields win over tier settings. `none` clears the effort field and lets the model inherit its provider default. An explicit planner override can exceed the caller model, subject to provider or organization restrictions.

The installer creates or replaces only TOML files with its exact Itixo-managed marker, refuses unmanaged conflicts, and skips unchanged managed files on reinstall. Its sorted summary adds `agent-models=` and `agent-efforts=` only when those overrides were supplied. Start a new task or restart Codex after installation so custom agents are discovered. Provider or organization restrictions may constrain available overrides.

To inspect or update installed Codex agents from any project, invoke `/itixo:update-models`. It uses the loaded plugin’s catalog, asks for personal or project scope, compares current settings, and applies confirmed choices with the bundled installer. New models become selectable after updating the Itixo plugin. Marketplace catalog changes remain a separate maintainer task.

## Usage (Copilot CLI)

Add this marketplace:

```
copilot plugin marketplace add ITIXO/itixo-marketplace
```

Install the plugin:

```
copilot plugin install itixo@itixo
```

When explicitly requested or enabled through a saved opt-in, the `dirigent` skill loads `rules/agents.md`, then delegates each step to the appropriate `itixo-*` agent at the prescribed model tier. Copilot CLI provides session-start and user-prompt hooks; its built-in general-purpose agent has no subagent-start hook, and prompt-hook output cannot inject context. The original user request and explicit skill invocation still handle those paths. Available agents include `itixo-investigator` (haiku, read-only locator), `itixo-builder` (sonnet, implementation), `itixo-tester`, `itixo-reviewer`, `itixo-security-reviewer` (claude-opus-5.5, read-only security review), `itixo-planner`, `itixo-docs-updater`, and `itixo-github-issues`.

## Adding a new plugin

1. Create `plugins/<provider>/<plugin>/.claude-plugin/plugin.json` (Claude), `plugins/<provider>/<plugin>/.codex-plugin/plugin.json` (Codex), and/or `plugins/<provider>/<plugin>/plugin.json` (Copilot CLI).
2. Add skills/commands/agents as needed.
3. Register Claude plugins in `.claude-plugin/marketplace.json`, Codex plugins in `.agents/plugins/marketplace.json`, and Copilot CLI plugins in `.github/plugin/marketplace.json`.
4. If adding or changing shared agent roles, generate committed Claude agents, Codex TOML templates, and Copilot agents with `node scripts/generate-agents.js`.
5. Run `node scripts/generate-agents.js --check`, `node --test tests/*.test.js`, and `node tests/validate.js`.
