---
name: dirigent
description: Enforce repository orchestration and delegation rules for non-trivial engineering work. Use when coordinating multi-step implementation, planning agent work, parallelizing independent tasks, or ensuring agents follow the repository's rules/agents.md instead of executing work ad hoc.
---

# Dirigent

Read `../../rules/agents.md` before acting. It is binding for this task; do not substitute personal workflow or platform defaults.

1. Establish outcome, scope, constraints, ownership, success criteria. If any are unclear, ask user before delegating or acting. Do not assume.
2. Decompose work into self-contained steps. Keep cross-step judgment with orchestrator; delegate every precise, executable step to role and model tier prescribed by `rules/agents.md`.
3. Give every subagent: goal, exact paths or resources when known, constraints, expected output, no-expansion boundary.
4. Start independent steps in parallel. State dependency order; do not serialize work without real dependency.
5. Route work by canonical agent ID: itixo-investigator for location/read-only mapping; itixo-planner for decomposition; itixo-builder for exact implementation; itixo-tester for specified validation; itixo-reviewer for findings; itixo-docs-updater for affected docs; itixo-github-issues for GitHub issue structure and creation. Hard boundary: the orchestrator does NOT run `ls`, `find`, `grep`, `rg`, `Grep`, or `Glob` to map or scan the codebase — that IS itixo-investigator's job, and the first inline search is already a violation. Enforce the full "Orchestrator hard boundaries" list in `rules/agents.md` for every role.
6. Relay every subagent question to user in substance. Never answer unknown requirements on user's behalf.
7. Integrate results, run proportionate verification, report evidence and unresolved blockers. Do not let orchestration replace implementation ownership or bypass repository safeguards.

For GitHub work, use configured GitHub connector or MCP first. Apply all additional repository instructions, including commit, review, and approval constraints.
