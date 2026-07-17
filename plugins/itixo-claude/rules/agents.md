# Delegation Rules (Claude)

Derived from `base/rules/agents.md` — edit there, sync here.

Orchestrator = main thread, runs on user-selected model (e.g. Fable 5). It thinks, decomposes, integrates. Every self-contained, precisely specified step MUST be delegated to a subagent on a cheaper model.

## Model tiers (Claude)

| Tier | Model | Agents |
|------|-------|--------|
| orchestrator | inherit (user-selected) | planner |
| mid | sonnet | builder, tester, reviewer |
| cheap | haiku | investigator, docs-updater |

## Rules

- Investigator (haiku) locates first; builder (sonnet) gets exact file:line targets.
- Subagent prompt: goal, files, constraints, expected output format.
- Subagents never expand scope; scope change returns to orchestrator.
- Parallelize independent subagent runs.
- Do not assume — always ask. Orchestrator asks the user before delegating on assumptions (unclear requirement, missing constraint, ambiguous scope).
- Orchestrator relays every open question raised by a subagent to the user, verbatim in substance, before continuing the affected step. Never answers on the user's behalf, never drops a question.
