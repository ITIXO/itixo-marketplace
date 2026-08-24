# Itixo Marketplace

Marketplace with an `itixo` plugin for each provider: Claude (Claude Code / Cowork), Codex, and Copilot. Provider-specific source directories are `plugins/claude/itixo`, `plugins/codex/itixo`, and `plugins/copilot/itixo`; the shared plugin ID is `itixo`. Orchestration (dirigent + agent roles) is the first module; more skills, agents, and rules accumulate over time.

## README is a product artifact

README = product front door. Non-technical people read it to decide if caveman worth install. Treat like UI copy.

## Structure

```
.claude-plugin/marketplace.json   # Marketplace manifest — Claude Code native, Codex legacy-compatible
.agents/plugins/marketplace.json  # Marketplace manifest — Codex native
.github/plugin/marketplace.json   # Marketplace manifest — Copilot native
.wiki/                             # Checkout of GitHub Wiki repository ITIXO/itixo-marketplace.wiki — place at root of main repository; separate Git repository, ignored by main repository
base/rules/agents.md              # Delegation rules + model tier table (source of truth)
base/agents/                      # Canonical platform-neutral agent role definitions
plugins/claude/itixo/             # Claude plugin (generated native agents, skills, rules, prompts)
plugins/codex/itixo/              # Codex plugin (generated TOML templates, installer, skills, prompts, rules)
plugins/copilot/itixo/            # Copilot plugin (native agent, skills, prompts)
scripts/generate-agents.js        # Generates Claude agents and Codex TOML templates from base/agents
tests/                            # generate-agents.test.js, validate.js
.github/workflows/                # CI workflows
```

## Standards

### Agent roles — generated files

- `base/agents/` is the canonical source for agent roles. Edit only there.
- Never hand-edit generated Claude agents in `plugins/claude/itixo/agents/` or generated Codex TOML templates in `plugins/codex/itixo/templates/agents/` — they carry a "Do not edit" marker and are overwritten by the generator.
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

| Tier | Claude | Codex | Copilot | Agents |
|------|--------|-------|---------|--------|
| orchestrator | inherit | user-selected | user-selected | itixo-planner |
| mid | sonnet | Terra + medium | claude-sonnet-5 | itixo-builder, itixo-github-issues, itixo-tester, itixo-reviewer |
| cheap | haiku | Luna + high (or Terra + low fallback) | claude-haiku-4.5 | itixo-investigator, itixo-docs-updater |
| security | opus + max | gpt-5.6-sol + max | claude-opus-5 | itixo-security-reviewer |

The eight `itixo-*` IDs are canonical and shared by Claude native agents and Codex custom agents. Without an explicit override, `itixo-planner` inherits the main task's model and effort and every other role uses its tier default.

Keep this table in sync with `base/rules/agents.md` and `scripts/generate-agents.js` (PROVIDERS map). Codex templates are inactive until explicitly installed; the Codex plugin's `itixo:install-agents` command asks for personal vs project scope, then cheap model and cheap effort as separate choices. Personal installs target `~/.codex/agents/`; project installs target `<project-root>/.codex/agents/` with an explicit root. Luna + high is the recommended cheap-role default; choose Terra + low when Luna workers are unavailable, or override either choice with `--cheap-model luna|terra` and `--cheap-effort high|low`. Mid roles use Terra + medium. Repeatable `--agent-model id=sol|terra|luna` and `--agent-effort id=none|low|medium|high|xhigh|max` options can override any of the eight installed agents; a per-agent field wins over the corresponding tier flag. An explicit planner Sol override may exceed the caller model. The installer only replaces exact Itixo-managed TOML files, refuses unmanaged conflicts, is idempotent for unchanged files, and requires a new task or Codex restart for discovery.

Claude keeps generated agent defaults unless the user explicitly requests a per-invocation override. A matching invocation may set `model` to `opus|sonnet|haiku|fable|inherit` and/or `effort` to `low|medium|high|xhigh|max`; omitted values keep generated defaults. An explicit Opus override may exceed the caller model. Provider or organization restrictions can still constrain either provider.

Security reviews are user-triggered in natural language, such as “Review my current changes for security issues.” `itixo-security-reviewer` is read-only and defaults to the current-branch diff from its merge base plus staged, unstaged, and relevant untracked files; request broader scope explicitly. On pull requests, post findings inline where possible or as a general comment, request changes for unresolved Critical or High findings when supported, and fall back to a self-review comment otherwise. A neutral comment reports a clean review. Automatic remediation is limited to localized behavior-preserving fixes without dependency/version updates, migrations, public API or auth-policy changes, secret rotation, or architecture changes; all other findings remain for user decision.

### Adding a new plugin

1. Create `plugins/<provider>/<plugin>/.claude-plugin/plugin.json` (Claude) and/or `plugins/<provider>/<plugin>/.codex-plugin/plugin.json` (Codex).
2. Add skills/commands/agents as needed.
3. Register Claude plugins in `.claude-plugin/marketplace.json` and Codex plugins in `.agents/plugins/marketplace.json`. The `itixo` Codex plugin is native-Codex-only and must not be listed in the Claude marketplace.
4. If adding or changing agent roles, regenerate Claude agents and Codex TOML templates with `node scripts/generate-agents.js`.
5. Run the verification commands above.

Provider identity is hardcoded in `scripts/providers.js`, shared by `scripts/generate-agents.js` and `scripts/validate-plugin-changes.js`; introducing a new provider requires updating `PROVIDERS` in `scripts/providers.js`. An unlisted `plugins/<provider>/<plugin>` fails validation with a hard error.

### Workflow

- Do not assume — ask when requirement, constraint, or scope is unclear.
- Start all future work in this repository on a new branch or in a new worktree; never work directly on `main` unless the user specifically asks.
- Non-trivial engineering work follows `base/rules/agents.md`: orchestrator decomposes and integrates; precisely specified steps are delegated to the prescribed role and model tier.
- Every plugin change requires a version bump in that plugin's manifest (`plugins/<provider>/<plugin>/.claude-plugin/plugin.json` and/or `.codex-plugin/plugin.json`), in semver format `MAJOR.MINOR.PATCH` with this project's mapping: nonbreaking change bumps patch, breaking change bumps minor, major rework bumps major. If unsure which bump applies, ask the user.
- Marketplace manifests do not mirror plugin version — `plugin.json` is the sole source of truth for each plugin's version, and manifests reference plugins via local relative paths, so there's no network-avoidance reason to cache a version as remote marketplaces (VS Code's, npm's) do.
- `changelog.md` is grouped by date, newest first, using `## YYYY-MM-DD` headings; each date is unique and strictly descends. By convention the file starts directly at the newest date heading with no H1 or preamble (not enforced by CI). Directly under each date is an optional common section of `-` bullets describing changes affecting multiple providers. Providers are listed as `### <provider>` (bare token: `claude`, `codex`, `copilot`), alphabetically ordered within a date, appearing at most once per date. Under each provider are versions as `#### <semver>` with no title text; versions strictly descend under their provider and across the file per provider; provider headings have no content before their first version. A version body is optional and, when present, uses `-` bullets; a bodyless version relies on the date's common bullets. Every date needs visible content and at least one provider, every provider at least one version. Breaking changes are marked inline as `- **Breaking:** ...`. Every plugin version change must add `#### <newversion>` under `### <provider>` beneath some date heading; CI matches the changed plugin only against its own provider's versions. New entries report only changes directly affecting plugin end users; omit repository or marketplace infrastructure, CI, build/release plumbing, generators, validation tooling, internal refactors, and any change without end-user impact. Wiki synchronization occurs automatically after a pull request.
- Commit after every meaningful unit of work. Conventional Commits: subject ≤50 chars, imperative; body only when "why" is not obvious.
- Changes go through pull requests; do not bypass branch or review rules.
- Codex plugins cannot register custom agents directly. The `itixo` Codex plugin distributes generated TOML templates and an explicit installer; the installed TOMLs own the agent instructions, model, and effort.
