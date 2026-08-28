# Documentation and embedded skills

The generated repository documents itself for both humans and agents, and carries its
own copies of `add-app` and `add-package` so a team without this skill installed can
still extend it correctly.

## AGENTS.md

```markdown
# AGENTS.md

Guidance for AI agents working in this repository.

## Conventions

- All code, comments, and documentation are written in English.
- Two-space indentation, single quotes, semicolons, no trailing commas. Biome enforces
  this; run `pnpm lint:fix` rather than reformatting by hand.
- React components are arrow functions with a named export. Default exports only where
  Next.js requires them.

## Commands

    pnpm install

    pnpm dev                                     # every application behind the gateway
    pnpm dev --filter=<app> --filter=gateway     # one application behind the gateway
    pnpm build                                   # all applications
    pnpm build --filter=<app>...                 # one application and its dependencies
    pnpm lint
    pnpm lint:fix
    pnpm check-types
    pnpm test

There are no per-application root scripts, and none may be added. Filtering is
Turborepo's job.

## Architecture

Independent Next.js applications, one per domain, each mounted on its own URL prefix and
reached through a single origin.

### Applications (`apps/`)

| Application | Port | Prefix | Purpose |
| --- | --- | --- | --- |
| shell | 3001 | / | Entry point, sign-in, navigation |
| <app> | <port> | /<app> | <purpose> |

An application declares its own identity in its `package.json`:

    "mfe": { "basePath": "/<app>", "port": <port> }

Nothing else stores the port or the prefix. The gateway, `next.config.ts`, and the dev
server all read that block.

### Gateway (`gateway/`, port 3000)

Development reverse proxy. It builds its routing table from `apps/*/package.json` at
boot, forwards WebSocket upgrades so hot reload works, and rewrites cookie paths to `/`
so a session is shared across applications. In production the ingress replaces it and
must implement the same three behaviours.

### Shared packages (`packages/`)

| Package | Owns |
| --- | --- |
| @repo/mfe | Application registry: gateway loader, `withMfe`, `mfe-dev` |
| @repo/typescript-config | Shared tsconfig bases |
| @repo/tailwind-config | Design tokens and PostCSS config |
| @repo/ui | Shared components, including `AppShell` |
| @repo/lib | Runtime env, HTTP client, query client, route registry |
| @repo/utils | Pure framework-agnostic helpers |
| @repo/auth | Session verification and route protection |
| @repo/logger | Structured logging |

Boundaries: `@repo/utils` may not import React, Next.js, or an HTTP client. `@repo/ui`
may depend on `@repo/lib` and `@repo/utils`. An application never imports from another
application — shared code moves into a package.

Packages are consumed as TypeScript source. They have no build step and no `dist`.
Applications list them in `transpilePackages`; the only path alias in an application is
`@/*`.

### Application internals

    src/app/          routing and layouts only
    src/features/     one folder per domain concern: components, hooks, api, types
    src/shared/       what two features in this application share
    src/proxy.ts      route protection

When something in `src/shared` is needed by a second application, promote it to a package.

### Dependencies

Every third-party version is pinned exactly, once, in the `catalog` block of
`pnpm-workspace.yaml`. Packages reference `catalog:`. Never add a version range to an
application's `package.json`.

### Configuration

Public configuration is read at runtime, not baked into the bundle. The server renders
`RuntimeEnvScript`, which serialises the values into `window.__ENV`; `@repo/lib/env`
reads them on both sides. Do not introduce `NEXT_PUBLIC_*` variables — one image must
serve every environment.

## Adding things

- New application: `.claude/skills/add-app`
- New shared package: `.claude/skills/add-package`
```

Fill the application table and the optional-package rows from the actual bootstrap
answers; do not document a package that was not created.

Add an "Unfinished by design" section listing what the bootstrap deliberately left as a
stub, and what it never exercised. At minimum:

- the `callback` route issues a development session for a fixed subject — it is not a
  real sign-in until the provider exchange replaces it,
- `AUTH_SESSION_SECRET` was generated locally into `.env` and is not a managed secret,
- the `api-types` schema and the brand tokens are placeholders,
- **the Docker surface is unverified** — no image was built or run,
- any deviation from the template, with its reason.

Anything a reader could mistake for working functionality must be named there.

## CLAUDE.md

```markdown
./AGENTS.md
```

## README.md

Written for humans, short: what the product is, the prerequisites (Node version from
`.nvmrc`, pnpm via corepack), how to install, how to run everything or a single
application, the port and prefix table, and how the gateway fits in. Link to `AGENTS.md`
for the architectural rules rather than repeating them.

## .claude/skills/add-app/SKILL.md

A repository-local condensation of `references/add-app.md`. It does not need the
divergence-detection section, because in a freshly bootstrapped repository the template
and the host agree. It must cover: asking for name, prefix, and port; rejecting a port
or prefix already claimed; writing the application files; adding routes to the registry;
adding an i18n namespace when that module exists; adding a compose service; updating the
application table in `AGENTS.md` and `README.md`; and verifying with `pnpm lint`,
`pnpm check-types`, and `pnpm build --filter=<app>`.

It must also carry the two things static checks cannot catch:

- the `config.matcher` needs a bare `'/'` entry or the landing page is public,
- routing has to be verified with real requests through the gateway, including that the
  new prefix does not over-match and does not get swallowed by the shell.

State plainly in it that adding an application must not add a root script.

## .claude/skills/add-package/SKILL.md

A repository-local condensation of `references/add-package.md`, including the bar for
justifying a package, the source-only `package.json` shape, the boundary README, and
wiring consumers through `transpilePackages`.
