---
name: add-app
description: Add a microfrontend application to this monorepo. Use when the user wants a new app, a new microfrontend, or a new URL prefix mounted behind the gateway.
---

# Add an application

Read `AGENTS.md` first: it holds the invariants this skill must preserve.

## Step 1 — Ask the user

- **Name.** It becomes the package name, the directory under `apps/`, and the value of
  `currentApp` in the layout.
- **URL prefix.** Defaults to `/<name>`.
- **Port.** Propose the next free port above the highest one currently claimed.
- **Shared packages** it starts with.
- **Authentication.** Does it need route protection?

Read every `apps/*/package.json` before answering. A port or a prefix already claimed by
another application is an **error, not a warning** — stop and ask for a different one.
`@repo/mfe` enforces both at gateway boot, so a collision breaks the whole repository,
not just the new application.

## Step 2 — Write the application

Mirror the smallest existing application. Files:

    apps/<app>/
      package.json          name, mfe key, scripts, dependencies (catalog: / workspace:*)
      next.config.ts        withMfe({ transpilePackages: [...] })
      tsconfig.json         extends @repo/typescript-config/react-library.json
      postcss.config.mjs
      src/app/layout.tsx    RuntimeEnvScript, QueryProvider, AppShell
      src/app/page.tsx      placeholder landing page
      src/app/globals.css   Tailwind plus @source over the packages it renders
      src/proxy.ts          only when the application requires authentication
      src/features/
      src/shared/
      public/

Rules that must hold:

- `mfe: { basePath, port }` in `package.json` is the **only** place the port and the
  prefix appear. No port in any script, no `basePath` in `next.config.ts`.
- Third-party dependencies use `catalog:`; workspace packages use `workspace:*`. Never a
  version range.
- The only path alias is `@/*`. Do not add paths reaching into `../../packages`.
- List a package in `transpilePackages` **and** in dependencies only if the application
  actually uses it.
- Do not set `assetPrefix`. `basePath` already prefixes assets and the gateway forwards
  the prefix unchanged.

**Adding an application must not add a root script.** The root has exactly five scripts.
If you feel the need for `dev:<app>`, use `pnpm dev --filter=<app> --filter=gateway`
instead.

## Step 3 — Register it

- **Gateway** — nothing to do. It builds its routing table from `apps/*/package.json` at
  boot and sorts by longest prefix. Verify only.
- **Route registry** — add the application's routes to `packages/lib/src/routes.ts` so
  the navigation shows them.
- **i18n** — add a namespace for the application in `packages/i18n/src/resources.ts` if
  it uses `@repo/i18n`.
- **Compose** — add a service in `docker-compose.yml` following the existing pattern, and
  list it under the gateway's `depends_on`.
- **Docs** — add a row to the application tables in `AGENTS.md` and `README.md`.

## Step 4 — Verify

```bash
pnpm install
pnpm lint --filter=<app>
pnpm check-types --filter=<app>
pnpm build --filter=<app>
```

Then confirm routing end to end:

```bash
pnpm dev --filter=<app> --filter=gateway
```

Against `http://localhost:3000`, confirm all four:

| Request | Expected | Catches |
| --- | --- | --- |
| `<prefix>` | answered by the new application | the prefix filter never matching |
| `<prefix>` unauthenticated | a redirect, not 200 | the `matcher` missing its bare `'/'` |
| `<prefix>/anything` | redirect to `/login` on **port 3000** | redirects leaking the internal port |
| `<prefix>s` | not served by the new application | the prefix capturing a longer sibling |

**Start only the new application and the gateway — never a full `pnpm dev` for this.**
While the shell runs, it answers a mis-routed prefix exactly as the new application would:
same status, same redirect, same `returnUrl`. A broken prefix filter looks completely
correct. The mis-route only becomes visible with the shell stopped, when the gateway
returns a 503 naming *the shell* for a request to `/<prefix>` — that names the component
that wrongly received the request, not the one at fault.

Re-run the same checks against each pre-existing application: an over-matching new prefix
damages its neighbours, not itself.

If a check fails, you get at most three autonomous fix attempts. On the third failure,
stop and report the exact error.

## Step 5 — Report

List every file created and modified, and the real result of each verification step. Say
plainly if a step was skipped or failed.
