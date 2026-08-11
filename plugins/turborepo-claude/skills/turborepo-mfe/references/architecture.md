# Architecture

The invariants below define the monorepo shape. Every mode of this skill preserves them,
and the generated `AGENTS.md` restates them for the teams that inherit the repository.

## Shape

```
<repo>/
  apps/
    shell/            :3001  ->  /            entry point, login, navigation
    <app>/            :3002  ->  /<app>       one domain per application
  packages/
    mfe/                     application registry helpers (next config, gateway loader)
    typescript-config/       shared tsconfig bases
    tailwind-config/         shared theme and PostCSS config
    ui/                      shared components, including the application chrome
    lib/                     runtime helpers: env, http, query client, route registry
    utils/                   framework-agnostic pure helpers (starts empty on purpose)
    auth/                    shared session verification and route protection
    logger/                  structured logging with a Seq sink
    i18n/                    optional: shared i18next setup
    api-types/               optional: types generated from the backend OpenAPI schema
  gateway/            :3000  development reverse proxy across all applications
  docker/                    Dockerfile used by every application
  turbo.json  pnpm-workspace.yaml  biome.json  vitest.config.ts
```

## Invariant 1 — the root has five scripts, and only five

```json
{
  "dev": "turbo run dev",
  "build": "turbo run build",
  "lint": "turbo run lint",
  "check-types": "turbo run check-types",
  "test": "vitest run"
}
```

Filtering belongs to Turborepo, not to the root `package.json`. pnpm appends any extra
arguments to the script, so this works out of the box:

```bash
pnpm dev                                        # every app plus the gateway
pnpm dev --filter=billing --filter=gateway      # one app behind the gateway
pnpm build --filter=billing...                  # an app and everything it depends on
```

Adding an application must never add a root script. If a mode is tempted to add one, the
design is wrong.

## Invariant 2 — an application describes itself

An application's identity lives in its own `package.json` under an `mfe` key, and
nowhere else:

```json
{
  "name": "billing",
  "mfe": { "basePath": "/billing", "port": 3002 }
}
```

Three consumers read that key, so it can never drift:

- the gateway builds its routing table from `apps/*/package.json` at boot,
- `withMfe()` in `next.config.ts` derives `basePath` from it,
- the `mfe-dev` binary starts Next.js on the declared port.

The shell application is the one with `basePath: "/"`. Exactly one application may claim
it, and it is always mounted last so that longer prefixes win.

## Invariant 3 — packages are consumed as source

Workspace packages export TypeScript source through their `exports` field. Applications
list them in `transpilePackages` and resolve them through pnpm's workspace links. There
is no build step for packages, no `dist` directory, no `tsc --watch`, and no `paths`
entry in an application's `tsconfig.json` pointing into `../../packages`. The only path
alias an application declares is `@/*` for its own `src`.

Consequence: `turbo run build` has a trivial graph, and editing a package hot-reloads in
every running application.

## Invariant 4 — one catalog, exact versions

Every third-party version lives once, in the `catalog` block of `pnpm-workspace.yaml`,
pinned exactly (no ranges). Packages and applications reference `catalog:`. `overrides`
is reserved for transitive conflicts only. Two applications can therefore never run
different versions of React, and a version bump is a one-line change.

## Invariant 5 — configuration is read at runtime, not baked at build time

Public configuration is never inlined through `NEXT_PUBLIC_*`. The server injects it into
the document as `window.__ENV`, and `@repo/lib/env` reads it on both sides. One container
image is therefore promoted unchanged from development to production; only environment
variables differ.

## Invariant 6 — the gateway mirrors production

In development, everything is reached through `http://localhost:3000`. The gateway
forwards by path prefix, proxies WebSocket upgrades so hot reload works, rewrites cookie
paths to `/` so a session is shared across applications, and renders a helpful 503 page
when a target application is not running. Production replaces it with the real ingress,
which must implement the same three behaviours.

## Invariant 7 — package boundaries

- `@repo/utils` holds framework-agnostic pure functions. No React, no Next.js, no HTTP
  client, no application-specific logic. It ships empty; that is deliberate.
- `@repo/lib` holds runtime helpers that may depend on React and the HTTP client.
- `@repo/ui` holds presentation. It may depend on `@repo/utils` and `@repo/lib`.
- An application never imports from another application. Shared code moves into a
  package instead.

## Invariant 8 — application internals are feature-first

```
apps/<app>/src/
  app/                    routing and layouts only
  features/<feature>/     components, hooks, api, types for one domain concern
  shared/                 what two features in this app share
  proxy.ts                route protection for this application
```

When something in `shared/` becomes useful to a second application, it moves to a
package. That promotion path is the reason `shared/` exists.

## Cross-application navigation

The route registry in `@repo/lib` lists every route of every application with its label
and required roles. `AppShell` in `@repo/ui` renders the navigation from it. Links inside
the current application use `next/link`; links to another application are plain anchors,
because crossing an application boundary is a full document load through the gateway.
