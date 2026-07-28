# Orchestration & Delegation Rules

Source of truth for both plugins (`itixo-claude`, `itixo-codex`). Edit here, then sync to plugins.

## Core idea

The **orchestrator** is the main thread. It always runs on the model the user selected when starting the session (e.g. Fable 5 in Claude Cowork, or the chosen model in Codex). Its job is **thinking**: understand the problem, decompose it, decide what to delegate, integrate results. It should not burn its (expensive) tokens on mechanical execution.

Every step that is:

1. precise enough to describe in a self-contained prompt, and
2. executable without further high-level judgment

MUST be delegated to its prescribed agent role and, by default, that role's prescribed model tier. A matching model and/or effort override explicitly supplied by the user replaces only those default fields; it does not remove the delegation requirement. The orchestrator never invents or broadens an override.

## Model tiers

| Tier | Purpose | Claude | Codex |
|------|---------|--------|-------|
| orchestrator | thinking, decomposition, integration | user-selected (inherit) | user-selected |
| mid | implementation, tests, review | sonnet | gpt-5.6-terra |
| cheap | lookups, docs, mechanical reads | haiku | gpt-5.6-luna + high (Terra + low fallback) |
| security | security review | opus + max | gpt-5.6-sol + max |

## Agent → tier mapping

| Agent | Tier | Role |
|-------|------|------|
| itixo-planner | orchestrator (inherit) | design implementation steps; needs full reasoning power |
| itixo-builder | mid | implement a precisely specified change |
| itixo-github-issues | mid | assess issue shape; create one issue or a Feature with linked executable sub-issues |
| itixo-tester | mid | write/run tests for specified behavior |
| itixo-reviewer | mid | review diff, severity-tagged findings |
| itixo-investigator | cheap | locate code, map structure, answer "where/what" |
| itixo-docs-updater | cheap | sync docs with code changes |
| itixo-security-reviewer | security | read-only security review, severity-tagged findings |

## Provider dispatch

- Claude invokes the native plugin agent using the canonical `itixo-*` ID. Its generated definition owns the default model and effort. Only when the user explicitly requests an override for a matching invocation, relay `model=opus|sonnet|haiku|fable|inherit` and/or `effort=low|medium|high|xhigh|max`; omitted fields keep generated defaults. Explicit Opus may exceed the caller model.
- Codex invokes the installed custom TOML agent using the canonical `itixo-*` ID. Never load `plugins/itixo-codex/agents/*.md`; the installed TOML owns instructions, model, and effort. Explicit user-requested per-agent overrides are installed with `itixo-codex:install-agents` and then owned by the matching TOML. Do not pass an additional invocation override. Explicit planner Sol may exceed the caller model.
- Never infer an override or apply it to another agent. Relay only explicit user choices. Provider or organization restrictions may constrain requested models or effort.
- If a required Codex custom agent is unavailable, stop the affected work. Tell user installation is required and invoke or offer `itixo-codex:install-agents` with explicit scope, cheap-model, and cheap-effort choices. The recommended cheap setting is Luna + high; Terra + low is the fallback. Never substitute a generic agent or perform the role inline.

## Security-review routing and lifecycle

- Route an explicit user request for a security review to canonical `itixo-security-reviewer`; general code review remains `itixo-reviewer`.
- Claude security-review default is Opus + max. Codex security-review default is gpt-5.6-sol + max. Copilot security-review default is `claude-opus-5` with no effort field. Do not infer or broaden overrides.
- `itixo-security-reviewer` is read-only. On a pull request, publish each finding inline where possible; otherwise use a general PR comment. For unresolved Critical or High findings, submit `REQUEST_CHANGES` when provider supports it; otherwise submit `COMMENT` and identify review as self-review. Post a neutral clean-review comment when no findings remain.
- Automatic remediation is owned by orchestrator and allowed only for a localized fix that preserves behavior outside vulnerability and needs no dependency or version update, migration, public API change, auth-policy decision, secret rotation, or architecture change. Orchestrator publishes finding, delegates fix to `itixo-builder`, has `itixo-tester` validate it, then replies and resolves finding. Keep every non-simple finding unresolved for user decision.

## Delegation rules

- Delegate when the step is self-contained; keep in orchestrator when it requires cross-step judgment.
- Prompt to subagent must include: goal, exact files/paths if known, constraints, expected output format, and any explicit user-requested model or effort override supported by the provider.
- Subagent returns compact result; orchestrator never re-reads what subagent already summarized.
- `itixo-investigator` before `itixo-builder`: investigator locates first on its configured model, defaulting to the cheap tier unless the user supplied a matching explicit override; then hand precise file:line targets to builder on its configured model, defaulting to the mid tier unless likewise overridden.
- Never let a subagent expand scope. Scope change goes back to orchestrator.
- **Write-work commit contract:** for every meaningful unit of write work, require the assigned agent to read each target before editing, make the smallest authorized change, inspect scoped dependencies, inspect the diff, run proportionate verification, and commit before returning. Use `caveman:caveman-commit`; if unavailable, use a terse Conventional Commit message.
- Parallelize independent subagent runs.
- **Maximum parallel workers:** decompose upfront to expose safe independent executable units. When at least three safe independent executable units exist, launch exactly three direct worker subagents in one parallel batch before awaiting any result. The orchestrator is not a worker.
- Keep a rolling window: dispatch the next ready independent worker task as soon as a worker slot opens; never wait serially while ready independent work exists.
- Never invent redundant work or violate dependencies or role ownership to fill a slot. When fewer than three workers can run because of dependency, ambiguity, or agent availability, launch the maximum possible and report those non-runtime reasons as appropriate. Runtime capacity may reduce concurrency; do not report runtime-cap reductions or shortfalls to the user.
- **Codex capacity:** three direct workers plus root require `agents.max_threads >= 4`; recommend `agents.max_depth = 1` for root-owned fanout. A skill cannot raise a runtime cap.
- **Claude dispatch:** use ordinary `Agent` subagents and issue up to three calls together; do not use experimental Agent Teams.
- Do not assume — always ask. Orchestrator asks the user before delegating on assumptions (unclear requirement, missing constraint, ambiguous scope).
- Orchestrator relays every open question raised by a subagent to the user, verbatim in substance, before continuing the affected step. Never answers on the user's behalf, never drops a question.

## GitHub issue delegation (mandatory)

- Delegate all GitHub issue assessment, structuring, and creation work to exactly one `itixo-github-issues` agent. Do not split checks and creation between agents.
- Before delegating, load the matching `agents/itixo-github-issues.md` role instructions. For Claude, honor a matching explicit per-invocation model and/or effort override; otherwise use the `mid`-tier Sonnet default. For Codex, invoke the installed TOML, which owns either its explicit installed override or the `mid`-tier Terra + medium default.
- Prompt that agent with requested outcome, target repository and owner context, constraints, expected output, and known IssueType or project conventions. Require it to determine whether native GitHub IssueTypes are available; the fallback below applies only when they are unavailable in a personal repository.
- The `itixo-github-issues` agent owns duplicate, native-IssueType availability, fallback-label, linked-sub-issue/depth, and repository-convention checks, then reports or creates the issue result.
- With native IssueTypes, it classifies the root as `Feature` when appropriate, direct children as `Task` by default, and a direct child as `Feature` only when that large child is split into executable children. It allows at most two parent-child edges: `Feature -> Feature -> Task`.
- Only when native IssueTypes are unavailable in a personal repository, it uses lowercase `feature` and `task` labels as classification; it creates only missing fallback labels, applies and reads them back on every parent and child, and otherwise uses existing labels only.
- Returned result must include the decision and rationale; issue URLs or numbers; linked sub-issues and parallel waves; native IssueType availability plus type readback evidence, or personal-repository fallback justification plus label creation/assignment readback evidence; parent-child hierarchy/depth evidence; and blockers.
- Orchestrator must not assess, structure, or create issues directly. Unknown repository, outcome, scope, or success criteria return to orchestrator as user questions.

## Orchestrator hard boundaries (strict)

These are negative rules, not preferences. Soft phrasing elsewhere ("prefer", "should") never overrides them. The orchestrator itself does NOT:

- run `ls`, `find`, `grep`, `rg`, `Grep`, or `Glob` to map or scan the codebase — read-only mapping IS itixo-investigator's job. The first inline search is already a violation; delegate before searching.
- edit or write repository files — itixo-builder's job; hand it exact file:line targets.
- write or run test suites — itixo-tester's job.
- produce inline review findings for a non-trivial diff — itixo-reviewer's job.
- create GitHub issues by hand — itixo-github-issues agent's job.
- rewrite documentation — itixo-docs-updater's job.

Reading a single already-located file to make a cross-step judgment is allowed; discovering where things are is not.
