---
name: dirigent
description: Enforce repository orchestration and delegation rules for non-trivial engineering work. Use when coordinating multi-step implementation, planning agent work, parallelizing independent tasks, or ensuring agents follow the repository's rules/agents.md instead of executing work ad hoc.
---

# Dirigent

Read `../../rules/agents.md` before acting. It is binding for this task; do not substitute personal workflow or platform defaults.

1. Establish outcome, scope, constraints, ownership, success criteria. If any are unclear, ask user before delegating or acting. Do not assume.
2. Decompose work into self-contained steps. Keep cross-step judgment with orchestrator; delegate every precise, executable step to the role and default model tier prescribed by `rules/agents.md`. Native Copilot agent definitions own their prescribed model tier; do not invent or broaden a model or effort override. Select the mid-tier provider model required by rules/agents.md.
3. Give every subagent: goal, exact paths or resources when known, constraints, expected output, no-expansion boundary.
4. Decompose upfront to expose safe independent executable units. When at least three safe independent executable units exist, launch exactly three direct native Copilot plugin-agent workers in one parallel batch before awaiting any result; orchestrator is not a worker. Keep a rolling window: dispatch next ready independent task as a slot opens; never wait serially while ready independent work exists. Never invent redundant work or violate dependencies or role ownership to fill a slot. If fewer than three can run because of dependency, ambiguity, or agent availability, use maximum possible and report those non-runtime reasons as appropriate. Runtime capacity may reduce concurrency; do not report runtime-cap reductions or shortfalls to user.
5. Route work by canonical native Copilot plugin-agent ID: itixo-investigator for location/read-only mapping; itixo-planner for decomposition; itixo-builder for exact implementation; itixo-tester for specified validation; itixo-reviewer for findings; itixo-docs-updater for affected docs; itixo-github-issues for GitHub issue structure and creation. Invoke the native Copilot plugin agent by that ID. Its definition owns the prescribed model tier; do not substitute a generic agent. Hard boundary: the orchestrator does NOT run `ls`, `find`, `grep`, `rg`, `Grep`, or `Glob` to map or scan the codebase — that IS itixo-investigator's job, and the first inline search is already a violation. Enforce the full "Orchestrator hard boundaries" list in `rules/agents.md` for every role.
6. Relay every subagent question to user in substance. Never answer unknown requirements on user's behalf.
7. Integrate results, run proportionate verification, report evidence and unresolved blockers. Do not let orchestration replace implementation ownership or bypass repository safeguards.

For all GitHub issue assessment, structuring, or creation, delegate all such work to exactly one `itixo-github-issues` subagent. Load the matching `../../agents/itixo-github-issues.agent.md` role instructions and invoke the native Copilot plugin agent by that canonical ID; its definition owns the mid-tier model. Include requested outcome, target repository context, constraints, and expected output in its task prompt. Orchestrator never creates an issue directly.

For GitHub work, use configured GitHub connector or MCP first. Apply all additional repository instructions, including commit, review, and approval constraints.
