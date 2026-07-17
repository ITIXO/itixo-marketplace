---
name: design-baseline-handover
description: Turn a Claude Design project into a committed repo baseline (DESIGN.md + design-system-spec.json + exported snapshot) that future Claude Design and Claude Code sessions can sync against for deeper UX/UI analysis and refinement. Use this whenever the user has created an initial design in Claude Design and wants to save it as a template, starting point, or source of truth for a repo that doesn't have a design system yet — phrases like "save this as a starting point," "turn this into a template," "set up the repo for my design," or "how do I keep refining this later" should all trigger it. Also use it when the user asks how to structure a design system folder, what to export from Claude Design, or what prompts to give Claude Design when resuming work on a different part of the system.
---

# Design Baseline

Bootstraps a brand-new repo (no existing design system) from a Claude Design
project, so the project becomes a durable, syncable baseline instead of a
one-off canvas session. This is for the "nothing exists yet" case — if the
user already has a design system in the repo, point them at `/design-sync`
directly instead of running this.

## When to use this

- User has built something in Claude Design and wants it as a "template" or
  "starting point" for later work.
- User is about to do deeper UX/UI analysis or refinement across multiple
  parts of a system and needs a stable reference.
- User asks what to export, what folder structure to use, or what to type
  into Claude Design to keep it on-brand across sessions.

## Workflow

### 1. Export the baseline artifact from Claude Design

Ask the user which they want (default to standalone HTML if they're not sure,
since it's the lowest-commitment snapshot):

- **Export as standalone HTML** — single self-contained file, good default
  for a first snapshot before component architecture is decided.
- **Handoff to Claude Code** (local agent or Claude Code Web) — turns the
  design into real component code. Prefer this once the user is ready to
  commit to a component structure, since `/design-sync` reads code more
  reliably than a flat HTML file.

Don't pick for them if the conversation doesn't make it obvious — ask.

### 2. Create the repo structure

Ask where the baseline should live — repo root (`/design/`) or nested under
an existing folder (e.g. `/design-system/design/`). Don't assume root; repos
that already have a `design-system/`-style folder for the full handoff
(below) should nest the baseline inside it instead of duplicating at root.

```
<chosen-path>/design/
  DESIGN.md                  ← human-readable design system doc
  design-system-spec.json    ← machine-readable token manifest
  initial-export.html        ← (or /components/ if handed off to Claude Code)
  /assets/                   ← reference screenshots, inspiration images used
```

Copy `references/DESIGN.md.template` and
`references/design-system-spec.template.json` into `<chosen-path>/design/`
and fill them in from what actually happened in the Claude Design
conversation — colors, typography, spacing, component inventory, and any UX
decisions worth remembering (why a pattern was chosen, not just what it
looks like). Don't invent values that weren't part of the design; leave a
section marked `TBD` rather than guessing.

**If the export is a full Claude Code handoff** (not just the HTML
snapshot), the baseline sits alongside a much larger generated tree — this
is normal, not a sign the baseline step did something wrong:

```
<chosen-path>/
  design/                    ← the baseline docs above
  components/<category>/     ← .jsx + .d.ts + .prompt.md per component
  tokens/*.css                ← CSS custom properties (colors, type, spacing, radius, shadow)
  guidelines/*.card.html      ← foundation specimen cards
  ui_kits/<product>/          ← screen recreations (index.html)
  SKILL.md, readme.md         ← Agent-Skill wrapper so the system is re-importable
```

Before committing, strip authoring debris that Claude Design tends to leave
behind: `.DS_Store`, an `uploads/` folder of pasted scratch images, and
duplicate copies of the same asset (e.g. a logo present both at the tree
root and under `assets/`). Keep one canonical copy per asset.

### 3. Write the resume prompt

Add a short "Resume prompt" block at the top of `DESIGN.md` — the literal
text the user should paste into a future Claude Design session to keep it
on-brand. Point it at wherever the baseline actually landed (see step 2):

```
Read <chosen-path>/design/DESIGN.md and
<chosen-path>/design/design-system-spec.json before generating anything.
Match existing tokens and components exactly; flag anything that doesn't
map to an existing pattern instead of inventing a new one.
```

If the repo is linked to Claude Code, mention `/design-sync` explicitly as
the mechanism that pulls this folder in automatically.

### 4. Commit — ask first

Per the user's standing preferences: never assume, always ask before
committing. When they confirm:

- Use the GitHub connector/MCP first (not raw git) if it's available.
- Use the repository-configured Git author identity; if missing, ask the user
  which identity to use. Never use a Claude account email.
- Commit after this meaningful unit of work using the `/caveman-commit`
  format.
- Never pass bypass flags on a PR unless explicitly asked.

## Model guidance

Anthropic doesn't currently expose a model picker inside Claude Design's own
UI — that part of the loop runs whatever Claude Design runs. But if you're
driving this through Claude Code (via `/design-sync` or the Claude Design
MCP server), normal Claude Code model selection applies, and the two halves
of this workflow have different profiles:

- **Writing `DESIGN.md` / synthesizing decisions / accessibility review** —
  reasoning-heavy, done once per baseline, low volume. Worth reaching for
  Opus (`--model opus` or `/model opus`) if you have headroom for it.
- **Iterating on the canvas itself / regenerating screens** — fast, cheap,
  high-volume back-and-forth. Sonnet is the better default; escalate to
  Opus only for a specific hard layout or architectural decision, not for
  the whole session.

Don't default to Opus for the whole workflow — it's the slower, more
expensive tier, and most of the iteration loop doesn't need the extra
reasoning depth.

## Reference files

- `references/DESIGN.md.template` — the 9-ish section doc to fill in.
- `references/design-system-spec.template.json` — machine-readable token
  manifest shape.
