## 2026-07-28

### 0.7.0 - claude

- **Breaking:** The Claude plugin's technical ID is now `itixo` (formerly `itixo-claude`). Its provider folder remains `plugins/itixo-claude`; update references that use the plugin ID.

### 0.6.1 - claude

- Claude adds the user-triggered, read-only `itixo-security-reviewer` with an `opus` + max default.
- It reviews the current-branch diff, staged and unstaged changes, and relevant untracked files unless broader scope is explicitly requested; pull-request findings are inline where possible or general otherwise, with `REQUEST_CHANGES` for unresolved Critical or High findings when supported, self-review `COMMENT` fallback, and a neutral clean-review comment.

### 0.6.0 - claude

- Claude no longer provides the `design-baseline-handover` skill or its design-baseline templates.

### 0.5.0 - claude

- The Claude plugin's public display name is now `itixo`; its technical plugin ID remains `itixo-claude`.

### 0.7.0 - codex

- **Breaking:** The Codex plugin's technical ID is now `itixo` (formerly `itixo-codex`). Its provider folder remains `plugins/itixo-codex`; update references that use the plugin ID.

### 0.6.1 - codex

- Codex adds the user-triggered, read-only `itixo-security-reviewer` with a `gpt-5.6-sol` + max default.
- It reviews the current-branch diff, staged and unstaged changes, and relevant untracked files unless broader scope is explicitly requested; pull-request findings are inline where possible or general otherwise, with `REQUEST_CHANGES` for unresolved Critical or High findings when supported, self-review `COMMENT` fallback, and a neutral clean-review comment.

### 0.6.0 - codex

- The Codex plugin release is aligned to version `0.6.0`.

### 0.5.0 - codex

- The Codex plugin's public display name is now `itixo`; its technical plugin ID remains `itixo-codex`.

### 0.7.0 - copilot

- **Breaking:** The Copilot plugin's technical ID is now `itixo` (formerly `itixo-copilot`). Its provider folder remains `plugins/itixo-copilot`; update references that use the plugin ID.

### 0.6.1 - copilot

- Copilot adds the user-triggered, read-only `itixo-security-reviewer` with a `claude-opus-5` default and no effort field, and updates mid-tier agents to `claude-sonnet-5`.
- Reviews default to the current-branch diff, staged and unstaged changes, and relevant untracked files unless broader scope is explicit; pull-request findings are inline where possible or general otherwise, with `REQUEST_CHANGES` for unresolved Critical or High findings when supported, self-review `COMMENT` fallback, and a neutral clean-review comment.

### 0.6.0 - copilot

- The Copilot plugin release is aligned to version `0.6.0`.

### 0.3.0 - copilot

- The Copilot plugin's public display name is now `itixo`; its technical plugin ID remains `itixo-copilot`.

## 2026-07-27

### 0.4.0 - claude

- Claude removed `/dirigent-stats`.

### 0.3.1 - claude

- Claude now automatically and safely removes temporary worktrees and branches created by its agents after work completes.

### 0.3.0 - claude

- **Breaking:** `/dirigent-stats` now reports only cache-backed root and unique subagent-run token totals, grouped by role, provider, and model; unavailable cache data uses the no-data result.

### 0.4.0 - codex

- Codex removed `/dirigent-stats`.

### 0.3.1 - codex

- Codex now automatically and safely removes temporary worktrees and branches created by its agents after work completes.

### 0.3.0 - codex

- **Breaking:** `/dirigent-stats` now reports only cache-backed root and unique subagent-run token totals, grouped by role, provider, and model; unavailable cache data uses the no-data result.

### 0.2.0 - copilot

- Copilot removed `/dirigent-stats`.
- Dirigent now enforces full orchestration parity with Claude and Codex.

## 2026-07-24

### 0.1.1 - copilot

- Copilot now documents `/itixo-copilot/dirigent-stats`, which reports exact recorded token usage for the current session and correlated recursive subagents.
- OpenTelemetry JSONL export must be enabled before starting a session; missing, malformed, unrelated, or ambiguous telemetry is reported as unavailable, with no estimates or transcript/database fallback.

## 2026-07-23

- Claude and Codex marketplace listings now provide richer plugin details, and Codex has a dedicated marketplace icon.

### 0.2.11 - claude

- Claude Dirigent statistics can now show agent usage, model usage, or both through `--view agents|models|both`, with both tables remaining the default.
- Reports use exact `kToks` values, and totals cover the root session plus recursive agents and each agent's input, cache, and output work without double-counting alternate table groupings.

### 0.2.10 - claude

- Claude users can explicitly override the model and effort for a matching agent invocation while omitted values keep generated defaults.
- An explicitly selected Opus planner may exceed the caller where provider and organization policy permits.

### 0.2.9 - claude

### 0.2.13 - codex

- Codex Dirigent statistics can now show agent usage, model usage, or both through `--view agents|models|both`, with both tables remaining the default.
- Reports use exact `kToks` values, and totals cover the root session plus recursive agents and each agent's input, cache, and output work without double-counting alternate table groupings.

### 0.2.12 - codex

- Codex Dirigent statistics now reproduce the cached hook report without internal markers or instructions.
- Before usage is recorded, the command returns only `No token usage available yet.`; nonzero reports contain only their heading, tables, total, and warnings.
- Counting starts automatically through session hooks after a new task or Codex restart following installation or update.

### 0.2.11 - codex

- Codex users can now install model and effort overrides independently for any of the seven `itixo-*` agents while preserving existing tier defaults when no override is supplied.
- An explicitly selected Sol planner may exceed the caller where provider and organization policy permits.

### 0.2.10 - codex

- The Codex agent installer now asks separately for the cheap-role model and effort, recommending Luna + high and supporting Terra + low as a fallback.
- Scope selection remains explicit, and each choice can be overridden with `--cheap-model` and `--cheap-effort`.

### 0.2.9 - codex

## 2026-07-22

- Namespaced marketplace invocations now return current-session reports for Claude `/itixo-claude:dirigent-stats` and Codex `$itixo-codex:dirigent-stats`. Existing unqualified forms remain supported.
- Both `itixo-claude` and `itixo-codex` initialize Dirigent statistics at `SessionStart`.
- After completed turns, `Stop` refreshes an atomic per-session cached report, so explicit stats requests normally return nearly instantly; a bounded fallback self-heals missing or invalid cache data.
- Recoverable and no-data cases no longer report the former context error, while same-session isolation remains preserved.
- GitHub Actions now validates plugins on pull requests and manual workflow dispatch, enforcing changed-plugin version bumps and a corresponding published Wiki version heading.
- Both marketplace entries are categorized as Developer Tools.
- Both `itixo-claude` and `itixo-codex` now register Dirigent statistics with the current session identity at `SessionStart` and report only the current root session plus its recursive subagents; cross-session selection is not supported.
- The skill description makes this per-session scope explicit.
- Orchestration now uses one root orchestrator with up to (and exactly, when fully provisioned) three direct workers.
- Codex recommends `agents.max_threads >= 4` and `max_depth = 1`; runtime-cap reductions are not reported.
- Both `itixo-claude` and `itixo-codex` now provide the explicitly invoked `dirigent-stats` skill (`/dirigent-stats` and `$dirigent-stats`).
- It reports exact current-task recorded token consumption for the orchestrator and all recursive subagents, aggregated by agent type and runtime model with run counts and one-decimal shares.
- Active and missing data are labeled; estimates and savings are not reported.
- The Codex runtime-model hook is preserved.
- Both providers now support four direct workers plus the orchestrator for safe parallel work.
- Claude uses ordinary subagents, not experimental Agent Teams; Codex requires `agents.max_threads >= 5` and recommends `max_depth = 1`.
- The skill saturates available independent work, refills freed slots, and reports concurrency-cap or dependency shortfalls.

### 0.2.8 - claude

### 0.2.7 - claude

### 0.2.6 - claude

### 0.2.5 - claude

### 0.2.4 - claude

### 0.2.3 - claude

### 0.2.8 - codex

### 0.2.7 - codex

### 0.2.6 - codex

### 0.2.5 - codex

### 0.2.4 - codex

### 0.2.3 - codex

## 2026-07-21

- Both `itixo-claude` and `itixo-codex` are now version `0.2.2`.
- This release documents structured responsibilities for orchestration, explicit strict tool and refusal boundaries, and unchanged capability allowlists.
- Claude and Codex provider artifacts were regenerated from the canonical agent definitions.

### 0.2.2 - claude

### 0.2.2 - codex

## 2026-07-20

- GitHub issue planning now uses native GitHub IssueTypes with readback: multi-workstream roots are `Feature`, direct children default to `Task`, and larger direct children may be `Feature` only when split into terminal `Task` children, bounded to `Feature -> Feature -> Task`.
- Personal repositories without native IssueTypes use lowercase `feature` and `task` labels as a narrow fallback, creating only missing fallback labels and reading assignments back on each parent and child.
- GitHub issue assessment, structuring, and creation must be delegated to exactly one `itixo-github-issues` agent with repository and owner context.
- Added validation coverage for IssueTypes, fallback labels, bounded hierarchy, and mandatory delegation; bumped both plugin manifests to `0.2.1`.
- **Breaking:** Generic agent identifiers were replaced by seven canonical `itixo-*` IDs. Migrate any configs or prompts that use the former generic IDs. Mappings: `builder` → `itixo-builder`; `docs-updater` → `itixo-docs-updater`; `github-issues` → `itixo-github-issues`; `investigator` → `itixo-investigator`; `planner` → `itixo-planner`; `reviewer` → `itixo-reviewer`; `tester` → `itixo-tester`.
- **Breaking:** Codex custom agents now require explicit installation with `itixo-codex:install-agents` before they can be discovered.
- **Breaking:** `itixo-codex` is a native `.codex-plugin` and is no longer listed in the Claude marketplace.

### 0.2.1 - claude

### 0.2.0 - claude

### 0.2.1 - codex

### 0.2.0 - codex
