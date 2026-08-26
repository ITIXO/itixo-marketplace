## 2026-08-19

### itixo-component-library-tables 0.1.0

- Initial release of the `itixo-component-library-tables` plugin for Copilot, which packages the `icl-tables` skill: a consumer guide to the `Itixo.ComponentLibrary.Tables` NuGet package covering server-side paginated, filterable, sortable, and searchable table endpoints, and CSV export.

## 2026-07-30

### itixo 0.7.1

- Every agent now uses the `caveman:caveman` skill when it is available and otherwise keeps its responses terse.
- The orchestrator now uses `mattpocock-skills:grill-me` when available to ask clarifying questions before delegating on assumptions; subagents still return open questions to the orchestrator.
- All three plugins and the delegation rules now recommend installing the caveman marketplace (https://github.com/JuliusBrussee/caveman) and Mattpocock Skills (https://github.com/mattpocock/skills).
- Copilot delegation rules now document the Copilot model tiers and the maximum-parallel-workers and rolling-window dispatch rules that were previously missing.

## 2026-07-28

### itixo 0.7.0

- **Breaking:** The Copilot plugin's technical ID is now `itixo` (formerly `itixo-copilot`). Its provider folder remains `plugins/itixo-copilot`; update references that use the plugin ID.

### itixo 0.6.1

- Copilot adds the user-triggered, read-only `itixo-security-reviewer` with a `claude-opus-5` default and no effort field, and updates mid-tier agents to `claude-sonnet-5`.
- Reviews default to the current-branch diff, staged and unstaged changes, and relevant untracked files unless broader scope is explicit; pull-request findings are inline where possible or general otherwise, with `REQUEST_CHANGES` for unresolved Critical or High findings when supported, self-review `COMMENT` fallback, and a neutral clean-review comment.

### itixo 0.6.0

- The Copilot plugin release is aligned to version `0.6.0`.

### itixo 0.3.0

- The Copilot plugin's public display name is now `itixo`; its technical plugin ID remains `itixo-copilot`.

## 2026-07-27

### itixo 0.2.0

- Copilot removed `/dirigent-stats`.
- Dirigent now enforces full orchestration parity with Claude and Codex.

## 2026-07-24

### itixo 0.1.1

- Copilot now documents `/itixo-copilot/dirigent-stats`, which reports exact recorded token usage for the current session and correlated recursive subagents.
- OpenTelemetry JSONL export must be enabled before starting a session; missing, malformed, unrelated, or ambiguous telemetry is reported as unavailable, with no estimates or transcript/database fallback.
