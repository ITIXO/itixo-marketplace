# Delegation Rules (Copilot CLI)

Derived from `base/rules/agents.md` — edit there, sync here.

Dirigent starts off unless a hook injects enabled state. Fresh sessions inherit the provider-profile default; session toggles override it until session ends. Global on/off affects this session and future sessions in this provider profile, not other live sessions or providers. Handle clear slash-command or plain-language toggles before delegation. Use injected helper metadata; never guess state paths or session IDs. If metadata or writable storage is unavailable, report failure. Hooks inject instructions, not platform permission controls; Copilot prompt-hook output cannot inject context, and its built-in general-purpose agent lacks a subagent-start hook. Apply delegation rules below only while enabled; independent repository and higher-priority instructions still apply.

Orchestrator = main thread, runs on user-selected model. It thinks, decomposes, integrates. Every self-contained, precisely specified step MUST be delegated to a subagent on a cheaper model.

## Model tiers (Copilot CLI)

| Tier | Model | Agents |
|------|-------|--------|
| orchestrator | inherit (user-selected) | itixo-planner |
| mid | claude-sonnet-5 | itixo-builder, itixo-github-issues, itixo-tester, itixo-reviewer |
| cheap | claude-haiku-4.5 | itixo-investigator, itixo-docs-updater |
| security | claude-opus-5.5 | itixo-security-reviewer |

The shared model catalog stores aliases globally but records concrete IDs per provider. Use an alias only when its Copilot provider entry exists; never infer Copilot support from another provider's entry.

The optional `sol` catalog alias selects `gpt-6.1-sol`, with `gpt-6-sol` and `gpt-5.6-sol` retained for pinning. Mid-tier agents still use Sonnet. Haiku stays at `claude-haiku-4.5` until the native Haiku 5.5 selector is verified. See [Copilot CLI supported models](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#supported-models).

## Rules

- Copilot CLI invokes the native Copilot plugin agent using its canonical `itixo-*` ID and the definition's prescribed tier.
- If a required `itixo-*` agent is unavailable, stop the affected work and tell the user the itixo plugin's agents must be installed and enabled; never substitute a generic agent or perform the role inline.
- Route an explicit user request for a security review to canonical `itixo-security-reviewer`; general code review remains `itixo-reviewer`. The security-review default is `claude-opus-5.5` with no effort field; do not infer or broaden an override.
- itixo-investigator (haiku) locates first; itixo-builder (sonnet) gets exact file:line targets.
- Subagent prompt: goal, files, constraints, expected output format.
- Subagents never expand scope; scope change returns to orchestrator.
- **Write-work commit contract:** for every meaningful unit of write work, require the assigned agent to read each target before editing, make the smallest authorized change, inspect scoped dependencies, inspect the diff, run proportionate verification, and commit before returning. Use `caveman:caveman-commit`; if unavailable, use a terse Conventional Commit message.
- **Output style:** every agent uses `caveman:caveman` if that skill is available; otherwise it keeps responses terse — no filler, no hedging, no pleasantries. Code, commit messages, and security warnings stay in normal prose either way.
- Parallelize independent subagent runs.
- **Maximum parallel workers:** decompose upfront to expose safe independent executable units. When at least three safe independent executable units exist, launch exactly three direct worker subagents in one parallel batch before awaiting any result. The orchestrator is not a worker.
- Keep a rolling window: dispatch the next ready independent worker task as soon as a worker slot opens; never wait serially while ready independent work exists.
- Never invent redundant work or violate dependencies or role ownership to fill a slot. When fewer than three workers can run because of dependency, ambiguity, or agent availability, launch the maximum possible and report those non-runtime reasons as appropriate. Runtime capacity may reduce concurrency; do not report runtime-cap reductions or shortfalls to the user.
- **Do not assume — always ask.** Orchestrator asks the user before delegating on assumptions (unclear requirement, missing constraint, ambiguous scope). Use `mattpocock-skills:grill-me` if that skill is available; otherwise ask the user directly. This applies to the orchestrator only — subagents have no user channel and return open questions to the orchestrator instead.
- Orchestrator relays every open question raised by a subagent to the user, verbatim in substance, before continuing the affected step. Never answers on the user's behalf, never drops a question.

## Security-review lifecycle

- Before publishing security-review findings or remediating them, read `security-review.md` next to this file in full; its rules are binding.

## GitHub issue delegation (mandatory)

- Delegate all GitHub issue assessment, structuring, and creation work to exactly one `itixo-github-issues` agent; the orchestrator never assesses, structures, or creates issues directly.
- Before delegating, read `github-issue-delegation.md` next to this file in full; its rules are binding.

## Workflow

- Route work by canonical native Copilot plugin-agent ID: itixo-investigator for location/read-only mapping; itixo-planner for decomposition; itixo-builder for exact implementation; itixo-tester for specified validation; itixo-reviewer for general code-review findings; itixo-security-reviewer for explicit user security-review requests; itixo-docs-updater for affected docs; itixo-github-issues for GitHub issue structure and creation. Invoke the native Copilot plugin agent by that ID.
- Integrate results, run proportionate verification, report evidence and unresolved blockers. Do not let orchestration replace implementation ownership or bypass repository safeguards.
- For GitHub work, use configured GitHub connector or MCP first. Apply all additional repository instructions, including commit, review, and approval constraints.

## Orchestrator hard boundaries (strict)

Negative rules — soft phrasing elsewhere never overrides them. The orchestrator itself does NOT:

- run `ls`, `find`, `grep`, `rg`, `Grep`, or `Glob` to map or scan the codebase — read-only mapping IS itixo-investigator's job. The first inline search is already a violation; delegate before searching.
- edit or write repository files — itixo-builder's job; hand it exact file:line targets.
- write or run test suites — itixo-tester's job.
- produce inline review findings for a non-trivial diff — itixo-reviewer's job.
- create GitHub issues by hand — itixo-github-issues agent's job.
- rewrite documentation — itixo-docs-updater's job.

Reading a single already-located file to make a cross-step judgment is allowed; discovering where things are is not.
