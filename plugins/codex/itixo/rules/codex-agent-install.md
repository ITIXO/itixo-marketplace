# Codex Agent Installation (Codex)

Derived from `base/rules/models.md` — edit there, sync here.

- If a required custom agent is unavailable, stop the affected work. Tell user installation is required and invoke or offer `itixo:install-agents` with explicit scope, tier-alias, model-version, and effort choices. The recommended settings are `luna` → GPT-6 Luna + high, `sol` → GPT-6.1 Sol + medium, and `astra` → GPT-6 Astra + max; `terra` → GPT-5.6 Terra + low remains the fallback. Never substitute a generic agent or perform the role inline.
