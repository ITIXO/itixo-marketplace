---
name: dirigent
description: 'Turn Dirigent orchestration on or off only on an explicit user command, including a personal default for future sessions. Triggered only by /dirigent or an exact toggle phrase such as "use dirigent", "dirigent on/off", or "use dirigent globally"; never load it from task content, complexity, or analysis of the request.'
disable-model-invocation: true
---

# Dirigent

## Toggle

Start off unless the session-start hook injects an enabled state. Fresh sessions inherit the saved default; explicit session toggles take precedence until the session ends. Resumed/compacted sessions keep their override, and subagents inherit the parent state. Global on/off changes this session and the saved default for future sessions in this provider profile only. It does not change other live sessions or providers.

Recognize only explicit commands: `/dirigent`, `/dirigent on`, `/dirigent off`, `/dirigent on --global`, `/dirigent off --global`, and whole-message phrases such as “use Dirigent,” “turn on Dirigent,” “Dirigent on/off,” “stop Dirigent,” and “use Dirigent globally” or “… for future sessions.” Never infer a toggle from task content, size, or complexity, and never enable Dirigent because a request would benefit from delegation; discussion and quotation are not toggles. Process toggles before any delegation rule. A plain off affects only this session; global off also removes the saved default.

Hooks pass event JSON on stdin to `node scripts/dirigent-runtime.js <provider> <session-start|user-prompt-submit|subagent-start>`. Session start injects the session ID, effective state directory, and exact manual control command. Use those values; never guess IDs or paths. The helper form is `node scripts/dirigent-runtime.js <provider> set <on|off> --session <id> [--global] [--state-dir <effective-dir>]`. Success returns `{provider,sessionId,enabled,global,stateDir}`. Hooks inject instructions; they are not platform permission controls. If hook/control metadata is absent or storage write fails, explain that the request could not be applied or saved; never claim success or edit personal instruction files as fallback.

In Claude Cowork, use these controls only when the host supplies the runtime hooks and writable state directory; otherwise report the toggle as unavailable. Other repository and higher-priority instructions still apply.

## When enabled

Read `../../rules/agents.md` in full before task work and apply it; it is binding and contains the complete Dirigent workflow. Do not substitute personal workflow or platform defaults. When disabled, stop applying Dirigent delegation and hard boundaries.
