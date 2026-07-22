---
name: dirigent-stats
description: Show exact task token usage by agent. Use only when the user explicitly invokes `/dirigent-stats` or `$dirigent-stats`.
---

# Dirigent Stats

Report only current session, including root orchestrator and recursive subagents. Consume hook-provided report from `dirigent-stats.js`; return marked Markdown verbatim. Reproduce tables without recalculation. Never estimate tokens or savings; preserve unknown values and warnings. If unavailable, say unavailable rather than estimating.
