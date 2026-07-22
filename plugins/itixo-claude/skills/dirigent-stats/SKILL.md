---
name: dirigent-stats
description: Show exact task token usage by agent. Use only when the user explicitly invokes `/dirigent-stats` or `$dirigent-stats`.
---

# Dirigent Stats

Consume the hook-provided report from `dirigent-stats.js` and return its marked Markdown verbatim. Reproduce its tables without recalculation. Never estimate tokens or savings; preserve unknown values and warnings. If no report is available, say it is unavailable rather than estimating.
