---
name: update-models
description: Verify or update provider model IDs, reasoning efforts, and agent defaults in the Itixo source checkout. Use when adding, replacing, or checking supported models across Claude, Codex, or Copilot.
---

# Update Itixo models

Use the source checkout. Never edit an installed plugin cache or installed agent files.

1. Honor a user-specified checkout. Otherwise use the current checkout only when it contains `CLAUDE.md`, `base/rules/agents.md`, `base/agents/`, all three provider plugin directories, and `scripts/generate-agents.js`. Verify its Git root and `origin` or `upstream` points to `ITIXO/itixo-marketplace` or a fork the user authorized. Reject caches and distribution copies. If multiple valid checkouts remain or no source checkout exists, ask which path to use.
2. Read source `AGENTS.md` when present, `CLAUDE.md`, `base/rules/agents.md`, the provider's `rules/agents.md`, the catalog at `plugins/codex/itixo/scripts/model-catalog.json`, the generator, and the Codex installer. Invoke the provider's `dirigent` skill for repository mapping and any implementation, test, or documentation delegation. Keep the catalog as the model source of truth.
3. Preserve legacy selectors, existing custom choices, and unrelated provider entries. For Codex, treat `models` as tier-to-alias assignments and each `aliases.<name>` object as the version catalog for that family. A request may independently change a tier assignment (`cheap=luna` → `cheap=terra`) and/or an alias's `default` or `versions` entry (`sol` → `gpt-6-sol`); do not require both changes. Verify each requested model's exact provider ID and supported reasoning efforts against current official provider documentation and local runtime constraints. Never infer an API ID across providers. Ask only when tier, provider scope, or replacement policy is missing.
4. For a verify or check request, make no edits: report the proposed catalog diff or that no change is needed, plus validation evidence. For an update or promote request, edit the catalog in the source checkout, update defaults only within the authorized tier policy, regenerate with `node scripts/generate-agents.js`, and update affected user-facing docs, versions, and changelogs.
5. For an update, run `node scripts/generate-agents.js --check`, `node --test tests/*.test.js`, `node tests/validate.js`, and `node scripts/validate-plugin-changes.js --base <resolved-merge-base> --changelog-dir .`. Resolve `<resolved-merge-base>` from the current branch and `origin/HEAD`; report a missing or unusable base instead of weakening the check. Inspect `git diff` and `git status`.
6. For an update, commit each meaningful unit with `caveman:caveman-commit` or a terse Conventional Commit. Create or update a reviewable PR only when the user explicitly authorized publishing, using the configured GitHub connector or MCP first. Do not merge, release, install, or mutate external systems implicitly.

After release, tell users to update the plugin through their provider's normal plugin flow. Codex users must explicitly rerun `itixo:install-agents` for the selected personal or project scope after model changes. The installer reads the current catalog, prompts for each tier alias and the concrete version of each used alias, and replaces managed files, so repeat custom model or effort overrides.
