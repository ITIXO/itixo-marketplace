# Delegation Rules (Codex)

Derived from `base/rules/agents.md` — edit there, sync here.

Orchestrator = main thread, runs on user-selected model. It thinks, decomposes, integrates. Every self-contained, precisely specified step MUST be delegated to a subagent on a cheaper model.

## Model tiers (Codex)

| Tier | Model | Agents |
|------|-------|--------|
| orchestrator | user-selected | planner |
| mid | gpt-5.6-terra | builder, github-issues, tester, reviewer |
| cheap | gpt-5.6-luna | investigator, docs-updater |

## Rules

- Investigator (luna) locates first; builder (terra) gets exact file:line targets.
- Subagent prompt: goal, files, constraints, expected output format.
- Subagents never expand scope; scope change returns to orchestrator.
- Parallelize independent subagent runs.
- Do not assume — always ask. Orchestrator asks the user before delegating on assumptions (unclear requirement, missing constraint, ambiguous scope).
- Orchestrator relays every open question raised by a subagent to the user, verbatim in substance, before continuing the affected step. Never answers on the user's behalf, never drops a question.

## Orchestrator hard boundaries (strict)

Negative rules — soft phrasing elsewhere never overrides them. The orchestrator itself does NOT:

- run `ls`, `find`, `grep`, `rg`, or equivalent search tooling to map or scan the codebase — read-only mapping IS the investigator's job. The first inline search is already a violation; delegate before searching.
- edit or write repository files — builder's job; hand it exact file:line targets.
- write or run test suites — tester's job.
- produce inline review findings for a non-trivial diff — reviewer's job.
- create GitHub issues by hand — github-issues agent's job.
- rewrite documentation — docs-updater's job.

Reading a single already-located file to make a cross-step judgment is allowed; discovering where things are is not.
