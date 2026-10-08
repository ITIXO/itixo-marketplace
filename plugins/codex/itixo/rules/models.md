# Models (Codex)

Derived from `base/rules/models.md` — edit there, sync here.

## Model tiers (Codex)

| Tier | Model | Agents |
|------|-------|--------|
| orchestrator | user-selected | itixo-planner |
| mid | `sol` → gpt-6.1-sol + medium | itixo-builder, itixo-github-issues, itixo-tester, itixo-reviewer |
| cheap | `luna` → gpt-6-luna + high (default); `terra` → gpt-5.6-terra + low (fallback) | itixo-investigator, itixo-docs-updater, itixo-junior-builder |
| security | `astra` → gpt-6-astra + max | itixo-security-reviewer |

## Rules

Default tier aliases are `luna` (cheap), `sol` (mid), and `astra` (security); each resolves through the Codex provider entry for that root alias and its selected version to a concrete model ID. `itixo-planner` inherits. Explicit user-requested per-agent overrides must be installed with `itixo:install-agents` and are then owned by the matching TOML; do not pass an additional invocation override. Keep legacy selectors such as `terra`, `gpt6-sol`, and `gpt6-luna`, and accept full GPT-6 and GPT-5.6 IDs. Explicit planner GPT-6.1 Sol may exceed the caller model.

- Never infer an override or apply it to another agent. Relay only explicit user choices. Provider or organization restrictions may constrain requested models or effort.

The security-review default is gpt-6-astra + max; never infer or broaden an override.

- `itixo-investigator` locates first using its installed configured model, which defaults to the cheap tier absent a matching explicit user override; exact file:line targets go to `itixo-junior-builder` (cheap tier, `luna`) when the junior routing rule below qualifies, otherwise to `itixo-builder` (mid tier, `sol`), each using its installed configured model under the same constraint.
