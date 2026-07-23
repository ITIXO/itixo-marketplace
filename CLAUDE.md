# Itixo Marketplace

Marketplace with plugins for Claude (Claude Code / Cowork) and Codex. `itixo-claude` and `itixo-codex` are company-wide libraries for Itixo people working with Claude or Codex. Orchestration (dirigent + agent roles) is the first module; more skills, agents, and rules accumulate over time.

## Structure

```
.claude-plugin/marketplace.json   # Marketplace manifest — Claude Code native, Codex legacy-compatible
.agents/plugins/marketplace.json  # Marketplace manifest — Codex native
.wiki/                             # Checkout of GitHub Wiki repository ITIXO-Playground/itixo-marketplace.wiki — place at root of main repository; separate Git repository, ignored by main repository
base/rules/agents.md              # Delegation rules + model tier table (source of truth)
base/agents/                      # Canonical platform-neutral agent role definitions
plugins/itixo-claude/             # Claude plugin (generated native agents, skills, rules, prompts)
plugins/itixo-codex/              # Codex plugin (generated TOML templates, installer, skills, prompts, rules)
scripts/generate-agents.js        # Generates Claude agents and Codex TOML templates from base/agents
tests/                            # generate-agents.test.js, validate.js
```

## Standards

### Agent roles — generated files

- `base/agents/` is the canonical source for agent roles. Edit only there.
- Never hand-edit generated Claude agents in `plugins/itixo-claude/agents/` or generated Codex TOML templates in `plugins/itixo-codex/templates/agents/` — they carry a "Do not edit" marker and are overwritten by the generator.
- After changing `base/agents/`, regenerate and commit the Claude agents and Codex TOML templates: `node scripts/generate-agents.js`.
- `rules/` and `AGENTS.md` files are maintained by hand and are not generated.

### Verification — run before submitting changes

```
node scripts/generate-agents.js --check
node --test tests/*.test.js
node tests/validate.js
```

All three must pass.

### Model tiers

| Tier | Claude | Codex | Agents |
|------|--------|-------|--------|
| orchestrator | inherit | user-selected | itixo-planner |
| mid | sonnet | Terra + medium | itixo-builder, itixo-github-issues, itixo-tester, itixo-reviewer |
| cheap | haiku | Luna + high (or Terra + low fallback) | itixo-investigator, itixo-docs-updater |

The seven `itixo-*` IDs are canonical and shared by Claude native agents and Codex custom agents. Without an explicit override, `itixo-planner` inherits the main task's model and effort and every other role uses its tier default. Version `0.2.0` is a breaking rename with no generic aliases.

Keep this table in sync with `base/rules/agents.md` and `scripts/generate-agents.js` (PROVIDERS map). Codex templates are inactive until explicitly installed; `itixo-codex:install-agents` asks for personal vs project scope, then cheap model and cheap effort as separate choices. Personal installs target `~/.codex/agents/`; project installs target `<project-root>/.codex/agents/` with an explicit root. Luna + high is the recommended cheap-role default; choose Terra + low when Luna workers are unavailable, or override either choice with `--cheap-model luna|terra` and `--cheap-effort high|low`. Mid roles use Terra + medium. Repeatable `--agent-model id=sol|terra|luna` and `--agent-effort id=none|low|medium|high|xhigh|max` options can override any of the seven installed agents; a per-agent field wins over the corresponding tier flag. An explicit planner Sol override may exceed the caller model. The installer only replaces exact Itixo-managed TOML files, refuses unmanaged conflicts, is idempotent for unchanged files, and requires a new task or Codex restart for discovery.

Claude keeps generated agent defaults unless the user explicitly requests a per-invocation override. A matching invocation may set `model` to `opus|sonnet|haiku|fable|inherit` and/or `effort` to `low|medium|high|xhigh|max`; omitted values keep generated defaults. An explicit Opus override may exceed the caller model. Provider or organization restrictions can still constrain either provider.

### Adding a new plugin

1. Create `plugins/<name>/.claude-plugin/plugin.json` (Claude) and/or `plugins/<name>/.codex-plugin/plugin.json` (Codex).
2. Add skills/commands/agents as needed.
3. Register Claude plugins in `.claude-plugin/marketplace.json` and Codex plugins in `.agents/plugins/marketplace.json`. `itixo-codex` is native-Codex-only and must not be listed in the Claude marketplace.
4. If adding or changing agent roles, regenerate Claude agents and Codex TOML templates with `node scripts/generate-agents.js`.
5. Run the verification commands above.

### Workflow

- Do not assume — ask when requirement, constraint, or scope is unclear.
- Start all future work in this repository on a new branch or in a new worktree; never work directly on `main` unless the user specifically asks.
- Non-trivial engineering work follows `base/rules/agents.md`: orchestrator decomposes and integrates; precisely specified steps are delegated to the prescribed role and model tier.
- Every plugin change requires a version bump in that plugin's manifest (`plugins/<name>/.claude-plugin/plugin.json` and/or `.codex-plugin/plugin.json`), in semver format `MAJOR.MINOR.PATCH` with this project's mapping: nonbreaking change bumps patch, breaking change bumps minor, major rework bumps major. If unsure which bump applies, ask the user.
- Every plugin version change must also update `.wiki/Changelog.md` under the exact `## <plugin-name>` section with an exact `### <semver>` release heading, newest first within that plugin. Each release needs a visible body, and CI matches the changed plugin only against its own section. New entries report only changes directly affecting plugin end users; omit repository or marketplace infrastructure, CI, build/release plumbing, generators, validation tooling, internal refactors, and any change without end-user impact.
- Commit after every meaningful unit of work. Conventional Commits: subject ≤50 chars, imperative; body only when "why" is not obvious.
- Changes go through pull requests; do not bypass branch or review rules.
- Codex plugins cannot register custom agents directly. `itixo-codex` distributes generated TOML templates and an explicit installer; the installed TOMLs own the agent instructions, model, and effort.
