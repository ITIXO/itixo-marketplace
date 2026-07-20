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
| github-issues | mid | assess issue shape; create one issue or a classified Feature with linked executable sub-issues |
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
- Do not assume — always ask. Orchestrator asks the user before delegating on assumptions (unclear requirement, missing constraint, ambiguous scope).
- Orchestrator relays every open question raised by a subagent to the user, verbatim in substance, before continuing the affected step. Never answers on the user's behalf, never drops a question.

## GitHub issue delegation (mandatory)

- Delegate all GitHub issue assessment, structuring, and creation work to exactly one `github-issues` agent. Do not split checks and creation between agents.
- Before delegating, load the matching `agents/github-issues.md` role instructions. Select the provider model in the `mid` tier from the table above.
- Prompt that agent with requested outcome, target repository and owner context, constraints, expected output, and known IssueType or project conventions. Require it to determine whether native GitHub IssueTypes are available; the fallback below applies only when they are unavailable in a personal repository.
- The `github-issues` agent owns duplicate, native-IssueType availability, fallback-label, linked-sub-issue/depth, and repository-convention checks, then reports or creates the issue result.
- With native IssueTypes, it classifies the root as `Feature` when appropriate, direct children as `Task` by default, and a direct child as `Feature` only when that large child is split into executable children. It allows at most two parent-child edges: `Feature -> Feature -> Task`.
- Only when native IssueTypes are unavailable in a personal repository, it uses lowercase `feature` and `task` labels as classification; it creates only missing fallback labels, applies and reads them back on every parent and child, and otherwise uses existing labels only.
- Returned result must include the decision and rationale; issue URLs or numbers; linked sub-issues and parallel waves; native IssueType availability plus type readback evidence, or personal-repository fallback justification plus label creation/assignment readback evidence; parent-child hierarchy/depth evidence; and blockers.
- Orchestrator must not assess, structure, or create issues directly. Unknown repository, outcome, scope, or success criteria return to orchestrator as user questions.

## Orchestrator hard boundaries (strict)

These are negative rules, not preferences. Soft phrasing elsewhere ("prefer", "should") never overrides them. The orchestrator itself does NOT:

- run `ls`, `find`, `grep`, `rg`, `Grep`, or `Glob` to map or scan the codebase — read-only mapping IS the investigator's job. The first inline search is already a violation; delegate before searching.
- edit or write repository files — builder's job; hand it exact file:line targets.
- write or run test suites — tester's job.
- produce inline review findings for a non-trivial diff — reviewer's job.
- create GitHub issues by hand — github-issues agent's job.
- rewrite documentation — docs-updater's job.

Reading a single already-located file to make a cross-step judgment is allowed; discovering where things are is not.
