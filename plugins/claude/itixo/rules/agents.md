# Delegation Rules (Claude)

Derived from `base/rules/agents.md` — edit there, sync here.

Dirigent starts off unless a hook injects enabled state. Fresh sessions inherit the provider-profile default; session toggles override it until session ends, and subagents inherit parent state. Global on/off affects this session and future sessions in this provider profile, not other live sessions or providers. Handle clear slash-command or plain-language toggles before delegation. Use injected helper metadata; never guess state paths or session IDs. If metadata or writable storage is unavailable, report failure. Hooks inject instructions, not platform permission controls. Apply delegation rules below only while enabled; independent repository and higher-priority instructions still apply.

Orchestrator = main thread, runs on user-selected model (e.g. Fable 5). It thinks, decomposes, integrates. Every self-contained, precisely specified step MUST be delegated to its prescribed agent role and, without a matching explicit user-requested per-invocation override, its prescribed model tier. Orchestrator never invents or broadens an override.

## Model tiers (Claude)

| Tier | Model | Agents |
|------|-------|--------|
| orchestrator | inherit (user-selected) | itixo-planner |
| mid | sonnet + medium | itixo-builder, itixo-github-issues, itixo-tester, itixo-reviewer |
| cheap | haiku + medium (Haiku 5.5 on Anthropic API) | itixo-investigator, itixo-docs-updater, itixo-junior-builder |
| security | opus + max | itixo-security-reviewer |

The shared model catalog stores aliases globally but records concrete IDs per provider. Use an alias only when its Claude provider entry exists; never infer Claude support from another provider's entry.

The `haiku` alias selects Haiku 5.5 on the Anthropic API and may select Haiku 4.5 on other providers. The catalog supports explicit `claude-haiku-5-5` and `claude-haiku-4-5` choices; use the provider’s documented model configuration to pin them. See [Claude model configuration](https://code.claude.com/docs/en/model-config).

## Rules

- Claude invokes the native plugin agent using its canonical `itixo-*` ID and the definition's prescribed default tier.
- If a required `itixo-*` agent is unavailable, stop the affected work and tell the user the itixo plugin's agents must be installed and enabled; never substitute a generic agent or do the role inline.
- Generated definitions own default model and effort. Only when the user explicitly requests an override for a matching invocation, relay `model=opus|sonnet|haiku|fable|inherit` and/or `effort=low|medium|high|xhigh|max`; omitted fields keep generated defaults. Explicit Opus may exceed the caller model.
- Never infer an override or apply it to another invocation. Provider or organization restrictions may constrain them.
- Route an explicit user request for a security review to canonical `itixo-security-reviewer`; general code review remains `itixo-reviewer`. The security-review default is Opus + max; never infer or broaden an override.
- `itixo-investigator` locates first on its configured invocation model, defaulting to cheap-tier Haiku absent a matching explicit user override; exact file:line targets go to `itixo-junior-builder` (Haiku) when the junior rule qualifies, else `itixo-builder` (Sonnet), each on its configured model under the same constraint.
- Subagent prompt: goal, files, constraints, expected output format, and any explicit user-requested model or effort override.
- Subagents never expand scope; changes return to orchestrator.
- **Write-work commit contract:** for every meaningful unit of write work, require the assigned agent to read each target before editing, make the smallest authorized change, inspect scoped dependencies, inspect the diff, run proportionate verification, and commit before returning. Use `caveman:caveman-commit`; if unavailable, use a terse Conventional Commit message.
- **Output style:** every agent uses `caveman:caveman` if that skill is available; otherwise it keeps responses terse — no filler, no hedging, no pleasantries. Code, commit messages, and security warnings stay normal prose.
- - **Maximum parallel workers:** decompose upfront to expose safe independent executable units. When at least three safe independent executable units exist, launch exactly three direct worker subagents in one parallel batch before awaiting any result. Orchestrator is not a worker.
- Keep rolling window: dispatch next ready independent worker task as soon as worker slot opens; never wait serially while ready independent work exists.
- Never invent redundant work or violate dependencies or role ownership to fill slot. When fewer than three workers can run because of dependency, ambiguity, or agent availability, launch maximum possible and report those non-runtime reasons as appropriate. Do not report runtime-cap reductions to user.
- Use ordinary `Agent` subagents and issue up to three calls together; do not use experimental Agent Teams.
- **Do not assume — always ask.** Orchestrator asks the user before delegating on assumptions (unclear requirement, missing constraint, ambiguous scope). Use `mattpocock-skills:grill-me` if that skill is available; otherwise ask the user directly. This applies to the orchestrator only — subagents have no user channel and return open questions to the orchestrator instead.
- Orchestrator relays every open question raised by a subagent to the user, verbatim in substance, before continuing the affected step. Never answers on the user's behalf, never drops a question.

## Security-review lifecycle

- Before publishing security-review findings or remediating them, read `security-review.md` next to this file in full; its rules are binding.

## GitHub issue delegation (mandatory)

- Delegate all GitHub issue assessment, structuring, and creation work to exactly one `itixo-github-issues` agent; the orchestrator never assesses, structures, or creates issues directly.
- Before delegating, read `github-issue-delegation.md` next to this file in full; its rules are binding.

## Workflow

- Route work by canonical native plugin-agent ID: itixo-investigator for location/read-only mapping; itixo-planner for decomposition; itixo-junior-builder for unambiguous low-thinking changes and exact scaffolding (rule below); itixo-builder for all other exact implementation; itixo-tester for specified validation; itixo-reviewer for general code-review findings; itixo-security-reviewer for explicit user security-review requests; itixo-docs-updater for affected docs; itixo-github-issues for GitHub issue structure and creation.
- **Junior routing:** delegate to `itixo-junior-builder` only when ALL hold: every target has exact path (file:line for edits); spec is unambiguous (need not be literal); no design choice, dependency research, or debugging; about 3 files or fewer (scaffolding exempt when every path and its content or spec is given). All other implementation: `itixo-builder`.
- Split larger work into junior-sized units only when obvious; never bend a task to fit junior.
- `itixo-junior-builder` returns to orchestrator on any open decision or verification failure, without debugging, retrying, or committing; orchestrator re-scopes or routes to `itixo-builder`.
- When documenting Codex installation choices, read root aliases and their Codex provider entries from the current catalog, then use provider-specific concrete versions; do not copy a stale model list or infer availability across providers.
- Integrate results, run proportionate verification, report evidence and unresolved blockers. Do not let orchestration replace implementation ownership or bypass repository safeguards.
- For GitHub work, use configured GitHub connector or MCP first. Apply all additional repository instructions, including commit, review, and approval constraints.

## Orchestrator hard boundaries (strict)

Negative rules — soft phrasing elsewhere never overrides them. The orchestrator itself does NOT:

- run `ls`, `find`, `grep`, `rg`, `Grep`, or `Glob` to map or scan the codebase — read-only mapping IS itixo-investigator's job. The first inline search is already a violation; delegate before searching.
- edit or write repository files — itixo-junior-builder's or itixo-builder's job; hand it exact file:line targets.
- write or run test suites — itixo-tester's job.
- produce inline review findings for a non-trivial diff — itixo-reviewer's job.
- create GitHub issues by hand — itixo-github-issues agent's job.
- rewrite documentation — itixo-docs-updater's job.

Reading a single already-located file to make a cross-step judgment is allowed; discovering where things are is not.
