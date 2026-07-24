---
name: dirigent-stats
description: Report exact recorded token usage for the current Copilot session and its recursive subagents. Use only when the user explicitly invokes /itixo-copilot/dirigent-stats.
user-invocable: true
---

# Dirigent Stats

This skill is invoked exactly as `/itixo-copilot/dirigent-stats`.

Report only the exact token totals recorded for the current Copilot session, including its root session and recursive subagents when they can be correlated. Do not estimate usage, savings, or missing values; do not read a private database or transcript as a fallback.

## Setup

Copilot must be launched with OpenTelemetry JSONL export enabled before the session starts. Set the exporter path to a restrictive, private location whose file remains readable for the session:

```sh
export COPILOT_OTEL_ENABLED=true
export COPILOT_OTEL_FILE_EXPORTER_PATH=/absolute/private/path/copilot-otel.jsonl
```

The file exporter is selected automatically from the path according to Copilot's OpenTelemetry configuration. Restart Copilot and start a new session after setting or changing these variables. Keep the telemetry file available and readable, and ensure records contain enough session identity to correlate them with the current session.

## Reporting rules

- Present the hook-injected report exactly as provided. Do not recalculate, reformat, summarize, or improvise values.
- If telemetry is missing, malformed, unrelated to the current session, or ambiguous, report exactly: `Unavailable: exact current-session Copilot telemetry is absent, invalid, or cannot be correlated.`
- Never substitute estimates, a private database, or conversation transcripts.
