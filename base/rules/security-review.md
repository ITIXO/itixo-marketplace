# Security Review

Source of truth for all provider plugins. Edit here, then sync to plugins.

- Claude security-review default is Opus + max. Codex security-review default is gpt-6-astra + max. Copilot security-review default is `claude-opus-5.5` with no effort field. Do not infer or broaden overrides.
- `itixo-security-reviewer` is read-only. On a pull request, publish each finding inline where possible; otherwise use a general PR comment. For unresolved Critical or High findings, submit `REQUEST_CHANGES` when provider supports it; otherwise submit `COMMENT` and identify review as self-review. Post a neutral clean-review comment when no findings remain.
- Automatic remediation is owned by orchestrator and allowed only for a localized fix that preserves behavior outside vulnerability and needs no dependency or version update, migration, public API change, auth-policy decision, secret rotation, or architecture change. Orchestrator publishes finding, delegates fix to `itixo-builder`, has `itixo-tester` validate it, then replies and resolves finding. Keep every non-simple finding unresolved for user decision.
