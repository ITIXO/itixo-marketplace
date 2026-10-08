# Model details

Source of truth for model tiers, overrides, and catalog rules. Edit here, then sync to plugins.

## Model tiers

| Tier | Purpose | Claude | Codex | Copilot |
|------|---------|--------|-------|---------|
| orchestrator | thinking, decomposition, integration | user-selected (inherit) | user-selected | user-selected |
| mid | implementation, tests, review | sonnet + medium | `sol` → gpt-6.1-sol + medium | claude-sonnet-5 |
| cheap | lookups, docs, mechanical reads, well-scoped implementation and scaffolding | haiku + medium | `luna` → gpt-6-luna + high (`terra` → gpt-5.6-terra + low fallback) | claude-haiku-5.5 |
| security | security review | opus + max | `astra` → gpt-6-astra + max | claude-opus-5.5 |

Supported provider model IDs, tier aliases, and reasoning efforts are maintained in `base/models/model-catalog.json`. Its root `aliases` are shared names; each alias contains provider-specific `default` and `versions` entries, and a provider entry means that alias is available there. `providers.<provider>.models` assigns those aliases to tiers. Codex and Copilot provide `/itixo:update-models` from their installed plugins: Codex reads the packaged catalog and applies confirmed settings through its bundled installer, while Copilot uses its native plugin update flow and verifies packaged agent defaults; Claude does not package this skill. Keep installed plugin caches and installed agent files read-only; preserve legacy selectors and user-selected overrides.

## Provider dispatch (models)

- Claude: Only when the user explicitly requests an override for a matching invocation, relay `model=opus|sonnet|haiku|fable|inherit` and/or `effort=low|medium|high|xhigh|max`; omitted fields keep generated defaults. Explicit Opus may exceed the caller model.
- Codex: Default tier aliases are `luna` (cheap), `sol` (mid), and `astra` (security); each resolves through its selected catalog version to a concrete model ID. `itixo-planner` inherits. Explicit user-requested per-agent overrides are installed with `itixo:install-agents` and then owned by the matching TOML. Keep legacy selectors such as `terra`, `gpt6-sol`, and `gpt6-luna`, and accept full GPT-6 and GPT-5.6 IDs. Do not pass an additional invocation override. Explicit planner GPT-6.1 Sol may exceed the caller model.
- Never infer an override or apply it to another agent. Relay only explicit user choices. Provider or organization restrictions may constrain requested models or effort.
- Codex install: explicit scope, tier-alias, model-version, and effort choices. The recommended settings are `luna` → GPT-6 Luna + high, `sol` → GPT-6.1 Sol + medium, and `astra` → GPT-6 Astra + max; `terra` → GPT-5.6 Terra + low remains the fallback.
- Copilot: Copilot has no effort field; never pass an effort override to a Copilot agent.

## Codex installation choices

- When documenting Codex installation choices, read root aliases and their Codex provider entries from the current catalog, then use provider-specific concrete versions; do not copy a stale model list or infer availability across providers.
