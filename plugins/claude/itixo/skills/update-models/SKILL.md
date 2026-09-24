---
name: update-models
description: Verify or update provider model IDs, reasoning efforts, and agent defaults in the Itixo source checkout. Use when adding, replacing, or checking supported models across Claude, Codex, or Copilot.
---

# Update Itixo models

Maintain the source checkout. Never edit an installed plugin cache or installed agent files.

1. Identify the repository that contains `CLAUDE.md`, `base/rules/agents.md`, `base/agents/`, `plugins/claude/itixo`, `plugins/codex/itixo`, `plugins/copilot/itixo`, and `scripts/generate-agents.js`. Verify its Git root and configured `origin`. Treat any marketplace or plugin cache as distribution only. If no source checkout is available, report the path needed and stop.
2. Read repository `CLAUDE.md`, `base/rules/agents.md`, and the provider's `rules/agents.md`. Read the model catalog at `plugins/codex/itixo/scripts/model-catalog.json`, the generator, and the Codex installer before editing. Keep the catalog as the model source of truth; do not add a second model list.
3. Preserve legacy aliases, existing custom choices, and unrelated provider entries. For each requested model, verify the exact provider ID and supported reasoning efforts against current official provider documentation and the local catalog/runtime constraints. Never infer an API ID from another provider's name. Ask only when the requested tier, provider scope, or replacement policy is missing.
4. Edit the catalog in the source checkout. Update provider defaults only when the user requested them or confirmed the tier policy. Keep generated agent files generated: run `node scripts/generate-agents.js` after source changes. Update affected README/rules, plugin versions, and provider changelogs when the change affects users.
5. Validate with `node scripts/generate-agents.js --check`, `node --test tests/*.test.js`, `node tests/validate.js`, and `node scripts/validate-plugin-changes.js --base <resolved-merge-base> --changelog-dir .`. Resolve `<resolved-merge-base>` from the current branch and `origin/HEAD`; report a missing or unusable base instead of weakening the check. Inspect `git diff` and `git status`.
6. Commit each meaningful unit with `caveman:caveman-commit` or a terse Conventional Commit. Create or update a reviewable PR only when the user explicitly authorized publishing and use the configured GitHub connector or MCP first. Do not merge, release, install, or mutate external systems implicitly.

After release, tell users to update the plugin through their provider's normal plugin flow. Codex users must explicitly rerun `itixo:install-agents` for the selected personal or project scope after model changes; the installer replaces managed files, so repeat any custom model or effort overrides.
