# Itixo Marketplace

Marketplace with plugins for Claude (Claude Code / Cowork) and Codex. `itixo-claude` and `itixo-codex` are company-wide libraries for Itixo people working with Claude or Codex. Orchestration (dirigent + agent roles) is the first module; more skills, agents, and rules accumulate over time.

## Structure

```
.claude-plugin/marketplace.json   # Marketplace manifest — Claude Code native, Codex legacy-compatible
.agents/plugins/marketplace.json  # Marketplace manifest — Codex native
base/rules/agents.md              # Delegation rules + model tier table (source of truth)
base/agents/                      # Canonical platform-neutral agent role definitions
plugins/itixo-claude/             # Claude plugin (generated agents, skills, rules, prompts)
plugins/itixo-codex/              # Codex plugin (generated agents, skills, prompts, rules)
scripts/generate-agents.js        # Generates provider agent files from base/agents
tests/                            # generate-agents.test.js, validate.js
```

## Standards

### Agent roles — generated files

- `base/agents/` is the canonical source for agent roles. Edit only there.
- Never hand-edit generated files under `plugins/*/agents/` — they carry a "Do not edit" marker and are overwritten by the generator.
- After changing `base/agents/`, regenerate and commit provider copies: `node scripts/generate-agents.js`.
- `rules/` and `AGENTS.md` files are maintained by hand and are not generated.

### Verification — run before submitting changes

```
node scripts/generate-agents.js --check
node --test tests/generate-agents.test.js
node tests/validate.js
```

All three must pass.

### Model tiers

| Tier | Claude | Codex | Agents |
|------|--------|-------|--------|
| orchestrator | inherit | user-selected | planner |
| mid | sonnet | gpt-5.6-terra | builder, github-issues, tester, reviewer |
| cheap | haiku | gpt-5.6-luna | investigator, docs-updater |

Keep this table in sync with `base/rules/agents.md` and `scripts/generate-agents.js` (PROVIDERS map).

### Adding a new plugin

1. Create `plugins/<name>/.claude-plugin/plugin.json` (Claude) and/or `plugins/<name>/.codex-plugin/plugin.json` (Codex).
2. Add skills/commands/agents as needed.
3. Register the plugin in `.claude-plugin/marketplace.json`; Codex-capable plugins also in `.agents/plugins/marketplace.json`.
4. If adding or changing agent roles, regenerate provider copies with `node scripts/generate-agents.js`.
5. Run the verification commands above.

### Workflow

- Do not assume — ask when requirement, constraint, or scope is unclear.
- Non-trivial engineering work follows `base/rules/agents.md`: orchestrator decomposes and integrates; precisely specified steps are delegated to the prescribed role and model tier.
- Commit after every meaningful unit of work. Conventional Commits: subject ≤50 chars, imperative; body only when "why" is not obvious.
- Changes go through pull requests; do not bypass branch or review rules.
- Codex plugins cannot define subagents or per-agent models — orchestration there is a prompt convention via `AGENTS.md` + `agents/` role files.
