---
name: dirigent
description: Turn Dirigent orchestration on or off when the user explicitly requests it, including a personal default for future sessions. Use for /dirigent and clear requests to use, start, enable, stop, disable, or turn Dirigent on or off; ordinary engineering work and discussion or quotation of the skill do not activate it.
---

# Dirigent

## Toggle

Start off unless the session-start hook injects an enabled state. Fresh sessions inherit the saved default; explicit session toggles take precedence until the session ends. Resumed/compacted sessions keep their override, and subagents inherit the parent state. Global on/off changes this session and the saved default for future sessions in this provider profile only. It does not change other live sessions or providers.

Recognize `/dirigent`, `/dirigent on`, `/dirigent off`, `/dirigent on --global`, `/dirigent off --global`, and clear plain-language equivalents such as “turn on Dirigent,” “stop Dirigent,” and “turn it on/off for future sessions.” Infer intent from ordinary wording; discussion and quotation are not toggles. Process toggles before any delegation rule. A plain off affects only this session; global off also removes the saved default.

Hooks pass event JSON on stdin to `node scripts/dirigent-runtime.js <provider> <session-start|user-prompt-submit|subagent-start>`. Session start injects the session ID, effective state directory, and exact manual control command. Use those values; never guess IDs or paths. The helper form is `node scripts/dirigent-runtime.js <provider> set <on|off> --session <id> [--global] [--state-dir <effective-dir>]`. Success returns `{provider,sessionId,enabled,global,stateDir}`. Hooks inject instructions; they are not platform permission controls. If hook/control metadata is absent or storage write fails, explain that the request could not be applied or saved; never claim success or edit personal instruction files as fallback.

In Claude Cowork, use these controls only when the host supplies the runtime hooks and writable state directory; otherwise report the toggle as unavailable. Other repository and higher-priority instructions still apply.

## When enabled

Read `../../rules/agents.md` in full before task work and apply it; it is binding and contains the complete Dirigent workflow. Do not substitute personal workflow or platform defaults. When disabled, stop applying Dirigent delegation and hard boundaries.
