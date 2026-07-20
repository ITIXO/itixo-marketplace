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

## GitHub issue delegation (mandatory)

- Delegate all GitHub issue assessment, structuring, and creation work to exactly one `github-issues` agent. Do not split checks and creation between agents.
- Before delegating, load matching `agents/github-issues.md` role instructions. Select `gpt-5.6-terra`, the `mid` model in the table above.
- Prompt that agent with requested outcome, target repository and owner context, constraints, expected output, and known IssueType or project conventions. Require it to determine whether native GitHub IssueTypes are available; the fallback below applies only when they are unavailable in a personal repository.
- The `github-issues` agent owns duplicate, native-IssueType availability, fallback-label, linked-sub-issue/depth, and repository-convention checks, then reports or creates the issue result.
- With native IssueTypes, it classifies the root as `Feature` when appropriate, direct children as `Task` by default, and a direct child as `Feature` only when that large child is split into executable children. It allows at most two parent-child edges: `Feature -> Feature -> Task`.
- Only when native IssueTypes are unavailable in a personal repository, it uses lowercase `feature` and `task` labels as classification; it creates only missing fallback labels, applies and reads them back on every parent and child, and otherwise uses existing labels only.
- Returned result must include the decision and rationale; issue URLs or numbers; linked sub-issues and parallel waves; native IssueType availability plus type readback evidence, or personal-repository fallback justification plus label creation/assignment readback evidence; parent-child hierarchy/depth evidence; and blockers.
- Orchestrator must not assess, structure, or create issues directly. Unknown repository, outcome, scope, or success criteria return to orchestrator as user questions.

## Orchestrator hard boundaries (strict)

Negative rules — soft phrasing elsewhere never overrides them. The orchestrator itself does NOT:

- run `ls`, `find`, `grep`, `rg`, or equivalent search tooling to map or scan the codebase — read-only mapping IS the investigator's job. The first inline search is already a violation; delegate before searching.
- edit or write repository files — builder's job; hand it exact file:line targets.
- write or run test suites — tester's job.
- produce inline review findings for a non-trivial diff — reviewer's job.
- create GitHub issues by hand — github-issues agent's job.
- rewrite documentation — docs-updater's job.

Reading a single already-located file to make a cross-step judgment is allowed; discovering where things are is not.
