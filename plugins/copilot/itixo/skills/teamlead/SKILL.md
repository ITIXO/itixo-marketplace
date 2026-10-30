---
name: teamlead
description: 'Turn Teamlead single-loop mode on or off only on an explicit user command, including a personal default for future sessions. Triggered only by /teamlead or an exact toggle phrase such as "use teamlead", "teamlead on/off", or "use teamlead globally"; never load it from task content, complexity, or analysis of the request.'
disable-model-invocation: true
---

# Teamlead

## Toggle

Start off unless the session-start hook injects an enabled state. Fresh sessions inherit the saved default; explicit session toggles take precedence until the session ends. Resumed sessions keep their override. Global on/off changes this session and the saved default for future sessions in this provider profile only. It does not change other live sessions or providers.

Teamlead state is separate from Dirigent. When both are on, the later toggle wins and the hook reports the effective mode; turning off the effective mode leaves no mode active in this session. If the hook reports that the order is unknown, ask the user which mode to use before task work.

Recognize only explicit commands: `/teamlead`, `/teamlead on`, `/teamlead off`, `/teamlead on --global`, `/teamlead off --global`, and whole-message phrases such as “use Teamlead,” “turn on Teamlead,” “Teamlead on/off,” “stop Teamlead,” and “use Teamlead globally” or “… for future sessions.” Never infer a toggle from task content, size, or complexity; discussion and quotation are not toggles. Process toggles before any other rule. A plain off affects only this session; global off also removes the saved default.

Hooks pass event JSON on stdin to `node scripts/dirigent-runtime.js <provider> <session-start|user-prompt-submit|subagent-start>`; one runtime serves Dirigent and Teamlead. Session start injects the session ID, effective state directories, and exact manual control commands. Use those values; never guess IDs or paths. The helper form is `node scripts/dirigent-runtime.js <provider> set <on|off> --session <id> --feature teamlead [--global] [--state-dir <effective-dir>]`. Success returns `{provider,sessionId,feature,enabled,global,stateDir}`. Copilot prompt-hook output cannot inject context, and Copilot's built-in general-purpose agent does not support `subagent-start`; the original request and explicit skill invocation cover those paths. Hooks inject instructions; they are not platform permission controls. If hook/control metadata is absent or storage write fails, explain that the request could not be applied or saved; never claim success or edit personal instruction files as fallback.

Other repository and higher-priority instructions still apply.

## When enabled

Read `../../rules/teamlead.md` in full before task work and apply it while Teamlead is the effective mode; it is binding. Dirigent delegation rules and hard boundaries do not apply then. When disabled or superseded by a later Dirigent toggle, stop applying Teamlead rules.
