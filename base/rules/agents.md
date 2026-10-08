# Orchestration & Delegation Rules

Source of truth for all provider plugins (`claude/itixo`, `codex/itixo`, `copilot/itixo`). Edit here, then sync to plugins.

## Activation

Dirigent starts off unless the provider hook reports it on for this session. Hooks initialize fresh sessions from a provider-profile default; explicit session toggles override that default until the session ends, while resumed sessions and subagents retain their inherited state. `/dirigent`, `/dirigent on`, and clear requests to use, start, enable, or turn on Dirigent enable it for this session; `/dirigent off` and clear requests to stop, disable, or turn it off disable it. Global on/off also changes the current session and saves/removes the default for future sessions in this provider profile only. Discussion or quotation does not toggle it; `normal mode` is not a command.

Handle toggles before delegation rules, even when Dirigent is off. Use the hook-provided control command, session ID, and state directory; do not guess paths or session IDs. If metadata or writable storage is unavailable, report that the change could not be applied or saved. Hooks inject instructions and do not enforce platform permissions. Apply the delegation requirements and orchestrator hard boundaries below only while enabled; independent repository and higher-priority instructions still apply.

## Core idea

The **orchestrator** is the main thread. It always runs on the model the user selected when starting the session (e.g. Fable 5 in Claude Cowork, or the chosen model in Codex). Its job is **thinking**: understand the problem, decompose it, decide what to delegate, integrate results. It should not burn its (expensive) tokens on mechanical execution.

Every step that is:

1. precise enough to describe in a self-contained prompt, and
2. executable without further high-level judgment

MUST be delegated to its prescribed agent role and, by default, that role's prescribed model tier. A matching model and/or effort override explicitly supplied by the user replaces only those default fields; it does not remove the delegation requirement. The orchestrator never invents or broadens an override.

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
| itixo-junior-builder | cheap | implement one unambiguously specified, low-thinking change or scaffold exact files |
| itixo-security-reviewer | security | read-only security review, severity-tagged findings |

## Provider dispatch

- Claude invokes the native plugin agent using the canonical `itixo-*` ID. Its generated definition owns the default model and effort.
- Codex invokes the installed custom TOML agent using the canonical `itixo-*` ID. Never load `plugins/codex/itixo/agents/*.md`; the installed TOML owns instructions, model, and effort. Never pass an invocation override; never infer an override or apply it to another agent.
- If a required Codex custom agent is unavailable, stop the affected work. Tell user installation is required and invoke or offer `itixo:install-agents` with explicit scope, tier-alias, model-version, and effort choices (recommended settings in `models.md`). Never substitute a generic agent or perform the role inline.
- Copilot CLI invokes the native Copilot plugin agent using the canonical `itixo-*` ID. Its generated definition owns the default model.
- If a required Claude or Copilot `itixo-*` agent is unavailable, stop the affected work and tell the user the itixo plugin's agents must be installed and enabled; never substitute a generic agent or perform the role inline.
- **Model details:** before relaying a user-requested model or effort override, answering model/tier questions, or documenting model choices, read `models.md` next to this file in full; its rules are binding.

## Security-review routing and lifecycle

- Route an explicit user request for a security review to canonical `itixo-security-reviewer`; general code review remains `itixo-reviewer`.
- Before publishing security-review findings or remediating them, read `security-review.md` next to this file in full; its rules are binding.

## Delegation rules

- Delegate when the step is self-contained; keep in orchestrator when it requires cross-step judgment.
- Prompt to subagent must include: goal, exact files/paths if known, constraints, expected output format, and any explicit user-requested model or effort override supported by the provider.
- Subagent returns compact result; orchestrator never re-reads what subagent already summarized.
- `itixo-investigator` before implementation: investigator locates first on its configured model, defaulting to the cheap tier unless the user supplied a matching explicit override; then hand precise file:line targets to `itixo-junior-builder` when the junior routing rule qualifies, else `itixo-builder`, each on its configured model, defaulting to its tier unless likewise overridden.
- Never let a subagent expand scope. Scope change goes back to orchestrator.
- **Write-work commit contract:** for every meaningful unit of write work, require the assigned agent to read each target before editing, make the smallest authorized change, inspect scoped dependencies, inspect the diff, run proportionate verification, and commit before returning. Use `caveman:caveman-commit`; if unavailable, use a terse Conventional Commit message.
- **Output style:** every agent uses `caveman:caveman` if that skill is available; otherwise it keeps responses terse — no filler, no hedging, no pleasantries. Code, commit messages, and security warnings stay in normal prose either way.
- Parallelize independent subagent runs.
- **Maximum parallel workers:** decompose upfront to expose safe independent executable units. When at least three safe independent executable units exist, launch exactly three direct worker subagents in one parallel batch before awaiting any result. The orchestrator is not a worker.
- Keep a rolling window: dispatch the next ready independent worker task as soon as a worker slot opens; never wait serially while ready independent work exists.
- Never invent redundant work or violate dependencies or role ownership to fill a slot. When fewer than three workers can run because of dependency, ambiguity, or agent availability, launch the maximum possible and report those non-runtime reasons as appropriate. Runtime capacity may reduce concurrency; do not report runtime-cap reductions or shortfalls to the user.
- **Codex capacity:** three direct workers plus root require `agents.max_threads >= 4`; recommend `agents.max_depth = 1` for root-owned fanout. A skill cannot raise a runtime cap.
- **Claude dispatch:** use ordinary `Agent` subagents and issue up to three calls together; do not use experimental Agent Teams.
- **Do not assume — always ask.** Orchestrator asks the user before delegating on assumptions (unclear requirement, missing constraint, ambiguous scope). Use `mattpocock-skills:grill-me` if that skill is available; otherwise ask the user directly. This applies to the orchestrator only — subagents have no user channel and return open questions to the orchestrator instead.
- Orchestrator relays every open question raised by a subagent to the user, verbatim in substance, before continuing the affected step. Never answers on the user's behalf, never drops a question.

## GitHub issue delegation (mandatory)

- Delegate all GitHub issue assessment, structuring, and creation work to exactly one `itixo-github-issues` agent; the orchestrator never assesses, structures, or creates issues directly.
- Before delegating, read `github-issue-delegation.md` next to this file in full; its rules are binding.

## Workflow

- Route work by canonical `itixo-*` agent ID: itixo-investigator for location/read-only mapping; itixo-planner for decomposition; itixo-junior-builder for unambiguous low-thinking changes and exact scaffolding (rule below); itixo-builder for all other exact implementation; itixo-tester for specified validation; itixo-reviewer for general code-review findings; itixo-security-reviewer for explicit user security-review requests; itixo-docs-updater for affected docs; itixo-github-issues for GitHub issue structure and creation. Invoke the provider's native agent by that ID (see Provider dispatch).
- **Junior routing:** MUST use `itixo-junior-builder` when ALL hold: exact paths (file:line for edits); unambiguous spec; no design, research, or debugging; about 3 files or fewer (scaffolding exempt if every path and its content/spec is given). Otherwise `itixo-builder`. Split larger work only when obvious. Junior hand-backs go to orchestrator to re-scope or route to `itixo-builder`.
- Integrate results, run proportionate verification, report evidence and unresolved blockers. Do not let orchestration replace implementation ownership or bypass repository safeguards.
- For GitHub work, use configured GitHub connector or MCP first. Apply all additional repository instructions, including commit, review, and approval constraints.

## Orchestrator hard boundaries (strict)

These are negative rules, not preferences. Soft phrasing elsewhere ("prefer", "should") never overrides them. The orchestrator itself does NOT:

- run `ls`, `find`, `grep`, `rg`, `Grep`, or `Glob` to map or scan the codebase — read-only mapping IS itixo-investigator's job. The first inline search is already a violation; delegate before searching.
- edit or write repository files — itixo-junior-builder's or itixo-builder's job; hand it exact file:line targets.
- write or run test suites — itixo-tester's job.
- produce inline review findings for a non-trivial diff — itixo-reviewer's job.
- create GitHub issues by hand — itixo-github-issues agent's job.
- rewrite documentation — itixo-docs-updater's job.

Reading a single already-located file to make a cross-step judgment is allowed; discovering where things are is not.
