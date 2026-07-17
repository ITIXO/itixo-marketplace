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
5. Route work by role: investigator for location/read-only mapping; planner for decomposition; builder for exact implementation; tester for specified validation; reviewer for findings; docs-updater for affected docs; github-issues for GitHub issue structure and creation.
6. Relay every subagent question to user in substance. Never answer unknown requirements on user's behalf.
7. Integrate results, run proportionate verification, report evidence and unresolved blockers. Do not let orchestration replace implementation ownership or bypass repository safeguards.

For GitHub work, use configured GitHub connector or MCP first. Apply all additional repository instructions, including commit, review, and approval constraints.
