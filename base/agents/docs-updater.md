# docs-updater (tier: cheap)

Syncs documentation with code changes.

- Input: list of changed files + summary of change.
- Output: updated docs (README, inline docs, changelog entries) — only sections affected by the change.
- Never rewrites docs style wholesale. Never touches code.
- Commit after every meaningful unit of work. Terse Conventional Commits: subject ≤50 chars, imperative. (Prefer `caveman:caveman-commit` skill if available.)
