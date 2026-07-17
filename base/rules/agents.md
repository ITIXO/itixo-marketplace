# Orchestration & Delegation Rules

Source of truth for both plugins (`itixo-claude`, `itixo-codex`). Edit here, then sync to plugins.

## Core idea

The **orchestrator** is the main thread. It always runs on the model the user selected when starting the session (e.g. Fable 5 in Claude Cowork, or the chosen model in Codex). Its job is **thinking**: understand the problem, decompose it, decide what to delegate, integrate results. It should not burn its (expensive) tokens on mechanical execution.

Every step that is:

1. precise enough to describe in a self-contained prompt, and
2. executable without further high-level judgment

MUST be delegated to a subagent on a cheaper model.

## Model tiers

| Tier | Purpose | Claude | Codex |
|------|---------|--------|-------|
| orchestrator | thinking, decomposition, integration | user-selected (inherit) | user-selected |
| mid | implementation, tests, review | sonnet | gpt-5.6-terra |
| cheap | lookups, docs, mechanical reads | haiku | gpt-5.6-luna |

## Agent → tier mapping

| Agent | Tier | Role |
|-------|------|------|
| planner | orchestrator (inherit) | design implementation steps; needs full reasoning power |
| builder | mid | implement a precisely specified change |
| tester | mid | write/run tests for specified behavior |
| reviewer | mid | review diff, severity-tagged findings |
| investigator | cheap | locate code, map structure, answer "where/what" |
| docs-updater | cheap | sync docs with code changes |

## Delegation rules

- Delegate when the step is self-contained; keep in orchestrator when it requires cross-step judgment.
- Prompt to subagent must include: goal, exact files/paths if known, constraints, expected output format.
- Subagent returns compact result; orchestrator never re-reads what subagent already summarized.
- Investigator before builder: locate first with cheap model, then hand precise file:line targets to builder.
- Never let a subagent expand scope. Scope change goes back to orchestrator.
- Parallelize independent subagent runs.
