---
name: turborepo-mfe
description: >
  Create and extend a pnpm + Turborepo microfrontend monorepo built from independent
  Next.js applications behind a path-prefix gateway. Use this skill whenever the user
  wants to bootstrap a new company monorepo, start a new frontend workspace from
  scratch, add another microfrontend application to an existing monorepo, or add a
  shared workspace package. Trigger for any of: "new turborepo", "bootstrap a
  monorepo", "create a new frontend repo", "add a new app/microfrontend",
  "add a shared package", "scaffold the monorepo", or any request to set up the
  standard company frontend repository structure.
---

# Turborepo Microfrontend Monorepo

This skill builds and extends a specific, opinionated monorepo shape: several
independent Next.js applications, each mounted on its own URL path prefix, sharing
workspace packages, and routed in development by a small express gateway.

Read `references/architecture.md` before writing any file. It defines the invariants
that every mode must preserve — the other references assume you know them.

## Modes

Pick the mode from the request. When it is ambiguous, ask.

| Mode | When | Reference |
| --- | --- | --- |
| `bootstrap` | The target is an empty or non-existent directory; the user wants a new monorepo. | `references/bootstrap.md` |
| `add-app` | An existing monorepo needs another microfrontend application. | `references/add-app.md` |
| `add-package` | An existing monorepo needs another shared workspace package. | `references/add-package.md` |

All literal file contents live in `references/files/`. **Load only the ones the current
mode needs** — the full set is around 2,000 lines, which is the right weight for a company
template and far too much to read before writing a two-page application. `bootstrap`
always needs `root`, `packages`, `gateway`, `app`, and `docs`; `docker` only when
containers are wanted; `add-app` needs `app` alone.

- `files/root.md` — root configuration (package.json, pnpm-workspace.yaml, turbo.json,
  biome.json, vitest, dotfiles)
- `files/gateway.md` — the development gateway
- `files/app.md` — a single application
- `files/packages.md` — shared workspace packages
- `files/docker.md` — Dockerfile and compose
- `files/docs.md` — AGENTS.md, README.md, and the skills embedded into the new repo

Each of these files carries pitfall notes earned from real failures — the gateway's
`pathFilter`, the auth `matcher`, the version cutoff, the tsconfig `types` allow-list.
Read the notes, not just the code blocks; they explain failures that are silent or that
point at the wrong component.

## Scripts

Executable helpers in `scripts/`. Prefer them over doing the same work from memory.

| Script | Purpose |
| --- | --- |
| `resolve-versions.mjs` | Resolves catalog versions that satisfy `minimumReleaseAge`. `--yaml` emits a paste-ready catalog block. Never pin from `npm view <pkg> version`. |
| `verify-routing.mjs` | Probes a live gateway for prefix routing and route protection. Exits 1 on failure, 2 when it cannot attribute a response. |

`verify-routing.mjs` needs the catch-all application **stopped** to attribute a prefix, so
run it one application at a time. It is the only check in this skill that can detect a
broken prefix filter or an unprotected landing page.

## Safety gates

These apply to every mode and must never be skipped.

1. **Never write outside the target directory.** In `bootstrap`, the target is the path
   the user gave. Refuse to bootstrap into a non-empty directory, and refuse when the
   target lies inside the repository this skill is currently running from.
2. **Never install a dependency the user did not approve.** The dependency set is fixed
   by `files/root.md` and the selected optional modules.
3. **Loop breaker.** If install, lint, type-check, or build fails, you get at most three
   autonomous fix attempts. On the third failure, stop and report the exact error and
   what you tried.
4. **Green static checks are not proof.** `lint`, `check-types`, and `build` say nothing
   about routing or route protection — both are runtime behaviour, and every routing bug
   found while developing this template passed all three. Any mode that touches a URL
   prefix or a `matcher` must verify with real requests through the gateway before
   reporting success.
5. **Report honestly.** If a verification step was skipped or failed, say so. Report
   deviations from the template and why they were necessary.

## Style rules for generated code

- Two-space indentation, single quotes, semicolons, no trailing commas — Biome enforces
  this and the shipped `biome.json` encodes it.
- React components are arrow functions with a named `export`; default exports only where
  a framework demands them (Next.js pages, layouts, `next.config.ts`).
- All generated code, comments, and documentation are written in English.
- Never invent placeholder people, companies, or sample data based on the current user.
  Use neutral fictional names such as `acme-portal`, `billing`, `crm`.
