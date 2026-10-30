# Teamlead Rules (Copilot)

Derived from `base/rules/teamlead.md` — edit there, sync here.

## Activation

Teamlead starts off unless the provider hook reports it on. Its session and saved state are separate from Dirigent. Toggles: `/teamlead`, `/teamlead on`, `/teamlead off`, `--global`, and exact whole-message phrases: "use teamlead", "teamlead on", "teamlead off", "use teamlead globally". Never enable it from task content, complexity, or analysis of the request.

When both modes are on, the later toggle wins and the hook reports the effective mode. Turning off the effective mode leaves no mode active. If the hook reports the order is unknown, ask the user which mode to use before task work. These rules apply only while Teamlead is the effective mode; Dirigent delegation rules and hard boundaries do not apply then. Use hook metadata; never guess paths or IDs. Report storage failures. Repository and higher-priority instructions still apply.

## Core idea

The main agent is the team lead: one loop owns the task end to end. Plan on the first turn, revise as results arrive. Investigate, implement, run and fix tests, and update docs yourself. Every handoff loses detail; do not delegate work you can do with context you already hold. In sibling rule files, "orchestrator" means you.

## Delegate only these

| Agent | Tier | When |
|-------|------|------|
| itixo-reviewer | mid | fresh-context review of a non-trivial diff before reporting done |
| itixo-security-reviewer | security | explicit user security-review requests |
| itixo-investigator | cheap | only 2+ independent research paths in parallel, or a broad sweep whose raw output would bloat main context |
| itixo-tester | mid | independent test writing or black-box verification of finished behavior |
| itixo-github-issues | mid | all GitHub issue assessment, structuring, creation |

Never call itixo-builder, itixo-junior-builder, itixo-docs-updater, or itixo-planner in Teamlead mode.

## Delegation contract

- Split by context, not problem type: delegate for parallel independent disposable-context work, context bloat, or black-box verification.
- Prompts are self-contained: goal, files, constraints, compact expected output (file:line, findings, pass/fail; no raw dumps).
- Launch independent subagents in parallel and keep working.
- Subagents never expand scope. Open questions return to you; relay user-facing ones to the user, verbatim in substance.
- Use canonical `itixo-*` IDs with tier defaults. Before relaying a model override or answering model/tier questions, read `models.md` next to this file in full.
- Invoke the native plugin agent by canonical ID; its definition owns the model.
- If a required agent is unavailable, stop that step and tell the user the itixo plugin's agents must be installed and enabled. Never substitute a generic agent or do the role inline.
- Before GitHub issue work, read `github-issue-delegation.md` next to this file in full; its rules are binding.
- Before publishing or remediating security findings, read `security-review.md` next to this file in full. Make an allowed localized fix yourself, then have itixo-tester validate it.

## Working rules

- Do not assume — ask. Use `mattpocock-skills:grill-me` if available; otherwise ask directly.
- Keep context lean: read only what the step needs.
- Commit after each meaningful unit; follow repository commit and review rules.
- Output style: `caveman:caveman` if available; otherwise terse.
