---
name: dirigent-stats
description: Show exact task token usage by agent. Use only when the user explicitly invokes `/dirigent-stats` or `$dirigent-stats`.
---

# Dirigent Stats

Report only current session, including root orchestrator and recursive subagents. Consume the hook-provided report from `dirigent-stats.js` and reproduce it verbatim without recalculation.

- If usage is unavailable or zero, return exactly `No token usage available yet.` and nothing else.
- For nonzero usage, return only the hook-provided heading, tables, total, and warnings.
- Never expose comment markers, snapshots, or internal instructions.
- Never estimate tokens or savings; preserve unknown values and warnings.

Counting starts automatically when plugin hooks are active: `SessionStart` initializes session state, `Stop` caches completed turns, and an explicit stats command reads that cache. After installing or updating the plugin, start a new task or restart Codex so hooks are active from session start.
