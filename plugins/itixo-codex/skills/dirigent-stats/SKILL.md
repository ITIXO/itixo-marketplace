---
name: dirigent-stats
description: Show exact current-task token usage grouped by agent, model, or both. Use only when the user explicitly invokes `/dirigent-stats` or `$dirigent-stats`.
---

# Dirigent Stats

Use `--view agents|models|both`; default to `both`. Examples: `$dirigent-stats --view agents`, `/dirigent-stats --view models`, `$itixo-codex:dirigent-stats --view both`.

For malformed, missing, duplicate, or unknown view values, return exactly `Invalid stats view. Use agents, models, or both.`

Return the selected cached report verbatim. Never recalculate, estimate, or double-sum. If usage is unavailable or zero, return exactly `No token usage available yet.` with no table.

Usage and total values are exact `kToks`, rendered with at most three decimals and trailing zeros removed; never convert to `mToks`. Totals include root orchestrator plus recursive agents and each agent's own input, cache-creation, cache-read, and output work, so aggregates can be large. Agent and model tables are alternate groupings of the same total; never add them together.

Counting starts automatically when plugin hooks are active: `SessionStart` initializes session state, `Stop` caches completed turns, and an explicit stats command reads that cache. After installing or updating the plugin, start a new task or restart Codex so hooks are active from session start.
