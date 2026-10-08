# Models (Copilot CLI)

Derived from `base/rules/models.md` — edit there, sync here.

## Model tiers (Copilot CLI)

| Tier | Model | Agents |
|------|-------|--------|
| orchestrator | inherit (user-selected) | itixo-planner |
| mid | claude-sonnet-5 | itixo-builder, itixo-github-issues, itixo-tester, itixo-reviewer |
| cheap | claude-haiku-5.5 | itixo-investigator, itixo-docs-updater, itixo-junior-builder |
| security | claude-opus-5.5 | itixo-security-reviewer |

The shared model catalog stores aliases globally but records concrete IDs per provider. Use an alias only when its Copilot provider entry exists; never infer Copilot support from another provider's entry.

The optional `sol` catalog alias selects `gpt-6.1-sol`, with `gpt-6-sol` and `gpt-5.6-sol` retained for pinning. Mid-tier agents still use Sonnet. The `haiku` alias selects `claude-haiku-5.5`, retaining `claude-haiku-4.5` for pinning. See [Copilot CLI supported models](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#supported-models).

## Rules

The security-review default is `claude-opus-5.5` with no effort field; do not infer or broaden an override.

- itixo-investigator (haiku) locates first; exact file:line targets go to itixo-junior-builder (claude-haiku-5.5) when the junior routing rule below qualifies, otherwise to itixo-builder (claude-sonnet-5).
