# Delegation Rules (Codex)

Derived from `base/rules/agents.md` — edit there, sync here.

Dirigent starts off unless a hook injects enabled state. Fresh sessions inherit the provider-profile default; session toggles override it until session ends, and subagents inherit parent state. Global on/off affects this session and future sessions in this provider profile, not other live sessions or providers. Handle clear slash-command or plain-language toggles before delegation. Use injected helper metadata; never guess state paths or session IDs. If metadata or writable storage is unavailable, report failure. Hooks inject instructions, not platform permission controls. Apply delegation rules below only while enabled; independent repository and higher-priority instructions still apply.

Orchestrator = main thread, runs on user-selected model. It thinks, decomposes, integrates. Every self-contained, precisely specified step MUST be delegated to its prescribed agent role using that role's installed model and effort. Without an explicit user-requested per-agent installation override, the prescribed tier defaults MUST be used. Orchestrator never invents or broadens an override.

## Model tiers (Codex)

| Tier | Model | Agents |
|------|-------|--------|
| orchestrator | user-selected | itixo-planner |
| mid | `sol` → gpt-6.1-sol + medium | itixo-builder, itixo-github-issues, itixo-tester, itixo-reviewer |
| cheap | `luna` → gpt-6-luna + high (default); `terra` → gpt-5.6-terra + low (fallback) | itixo-investigator, itixo-docs-updater |
| security | `astra` → gpt-6-astra + max | itixo-security-reviewer |

## Rules

- Codex invokes the installed custom TOML agent using its canonical `itixo-*` ID. Never load `plugins/codex/itixo/agents/*.md`; the TOML owns instructions, model, and effort. Default tier aliases are `luna` (cheap), `sol` (mid), and `astra` (security); each resolves through the Codex provider entry for that root alias and its selected version to a concrete model ID. `itixo-planner` inherits. Explicit user-requested per-agent overrides must be installed with `itixo:install-agents` and are then owned by the matching TOML; do not pass an additional invocation override. Keep legacy selectors such as `terra`, `gpt6-sol`, and `gpt6-luna`, and accept full GPT-6 and GPT-5.6 IDs. Explicit planner GPT-6.1 Sol may exceed the caller model.
- Never infer an override or apply it to another agent. Relay only explicit user choices. Provider or organization restrictions may constrain requested models or effort.
- If a required custom agent is unavailable, stop the affected work and read `codex-agent-install.md` next to this file before responding; never substitute a generic agent or perform the role inline.
- Route an explicit user request for a security review to canonical `itixo-security-reviewer`; general code review remains `itixo-reviewer`. The security-review default is gpt-6-astra + max; never infer or broaden an override.
- `itixo-investigator` locates first using its installed configured model, which defaults to the cheap tier absent a matching explicit user override; `itixo-builder` gets exact file:line targets using its installed configured model, which defaults to the mid tier under the same constraint.
- Subagent prompt: goal, files, constraints, expected output format, and any explicit user-requested override supported by Codex.
- Subagents never expand scope; scope change returns to orchestrator.
- **Write-work commit contract:** for every meaningful unit of write work, require the assigned agent to read each target before editing, make the smallest authorized change, inspect scoped dependencies, inspect the diff, run proportionate verification, and commit before returning. Use `caveman:caveman-commit`; if unavailable, use a terse Conventional Commit message.
- **Output style:** every agent uses `caveman:caveman` if that skill is available; otherwise it keeps responses terse — no filler, no hedging, no pleasantries. Code, commit messages, and security warnings stay in normal prose either way.
- Parallelize independent subagent runs.
- **Maximum parallel workers:** decompose upfront to expose safe independent executable units. When at least three safe independent executable units exist, launch exactly three direct worker subagents in one parallel batch before awaiting any result. Orchestrator is not a worker.
- Keep rolling window: dispatch next ready independent worker task as soon as worker slot opens; never wait serially while ready independent work exists.
- Never invent redundant work or violate dependencies or role ownership to fill slot. When fewer than three workers can run because of dependency, ambiguity, or agent availability, launch maximum possible and report those non-runtime reasons as appropriate. Runtime capacity may reduce concurrency; do not report runtime-cap reductions or shortfalls to user.
- Three direct workers plus root require `agents.max_threads >= 4`; recommend `agents.max_depth = 1` for root-owned fanout. A skill cannot raise a runtime cap.
- **Do not assume — always ask.** Orchestrator asks the user before delegating on assumptions (unclear requirement, missing constraint, ambiguous scope). Use `mattpocock-skills:grill-me` if that skill is available; otherwise ask the user directly. This applies to the orchestrator only — subagents have no user channel and return open questions to the orchestrator instead.
- Orchestrator relays every open question raised by a subagent to the user, verbatim in substance, before continuing the affected step. Never answers on the user's behalf, never drops a question.

## Security-review lifecycle

- Before publishing security-review findings or remediating them, read `security-review.md` next to this file in full; its rules are binding.

## GitHub issue delegation (mandatory)

- Delegate all GitHub issue assessment, structuring, and creation work to exactly one `itixo-github-issues` agent; the orchestrator never assesses, structures, or creates issues directly.
- Before delegating, read `github-issue-delegation.md` next to this file in full; its rules are binding.

## Workflow

- Route work by canonical custom-agent ID: itixo-investigator for location/read-only mapping; itixo-planner for decomposition; itixo-builder for exact implementation; itixo-tester for specified validation; itixo-reviewer for general code-review findings; itixo-security-reviewer for explicit user security-review requests; itixo-docs-updater for affected docs; itixo-github-issues for GitHub issue structure and creation. Invoke the installed custom TOML agent by that ID.
- Integrate results, run proportionate verification, report evidence and unresolved blockers. Do not let orchestration replace implementation ownership or bypass repository safeguards.
- For GitHub work, use configured GitHub connector or MCP first. Apply all additional repository instructions, including commit, review, and approval constraints.

## Orchestrator hard boundaries (strict)

Negative rules — soft phrasing elsewhere never overrides them. The orchestrator itself does NOT:

- run `ls`, `find`, `grep`, `rg`, or equivalent search tooling to map or scan the codebase — read-only mapping IS itixo-investigator's job. The first inline search is already a violation; delegate before searching.
- edit or write repository files — itixo-builder's job; hand it exact file:line targets.
- write or run test suites — itixo-tester's job.
- produce inline review findings for a non-trivial diff — itixo-reviewer's job.
- create GitHub issues by hand — itixo-github-issues agent's job.
- rewrite documentation — itixo-docs-updater's job.

Reading a single already-located file to make a cross-step judgment is allowed; discovering where things are is not.
