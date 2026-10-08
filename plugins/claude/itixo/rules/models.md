# Model details

Derived from `base/rules/models.md` — edit there, sync here.

## Model tiers (Claude)

| Tier | Model | Agents |
|------|-------|--------|
| orchestrator | inherit (user-selected) | itixo-planner |
| mid | sonnet + medium | itixo-builder, itixo-github-issues, itixo-tester, itixo-reviewer |
| cheap | haiku + medium (Haiku 5.5 on Anthropic API) | itixo-investigator, itixo-docs-updater, itixo-junior-builder |
| security | opus + max | itixo-security-reviewer |

The shared model catalog stores aliases globally but records concrete IDs per provider. Use an alias only when its Claude provider entry exists; never infer Claude support from another provider's entry.

The `haiku` alias selects Haiku 5.5 on the Anthropic API and may select Haiku 4.5 on other providers. The catalog supports explicit `claude-haiku-5-5` and `claude-haiku-4-5` choices; use the provider’s documented model configuration to pin them. See [Claude model configuration](https://code.claude.com/docs/en/model-config).

## Rules

- Generated definitions own default model and effort. Only when the user explicitly requests an override for a matching invocation, relay `model=opus|sonnet|haiku|fable|inherit` and/or `effort=low|medium|high|xhigh|max`; omitted fields keep generated defaults. Explicit Opus may exceed the caller model.
- Never infer an override or apply it to another invocation. Provider or organization restrictions may constrain requested models or effort.
- The security-review default is Opus + max; never infer or broaden an override.
- `itixo-investigator` locates first on its configured invocation model, defaulting to cheap-tier Haiku absent a matching explicit user override; exact file:line targets go to `itixo-junior-builder` (Haiku) when the junior rule qualifies, else `itixo-builder` (Sonnet), each on its configured model under the same constraint.

## Codex installation choices

- When documenting Codex installation choices, read root aliases and their Codex provider entries from the current catalog, then use provider-specific concrete versions; do not copy a stale model list or infer availability across providers.
