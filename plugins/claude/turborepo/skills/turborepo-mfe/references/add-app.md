# Mode: add-app

Adds one microfrontend application to an existing monorepo. This mode runs in
repositories that were not created by this skill, so it treats the host repository — not
the template — as the source of truth wherever the two disagree.

## Step 1 — Learn the host repository

Read, in this order:

- `pnpm-workspace.yaml` — is there a catalog? are `apps/*` and `packages/*` workspaces?
- the root `package.json` — how are scripts organised?
- `turbo.json` — which tasks exist, and what are they called?
- one existing application, preferably the smallest, as the reference: its
  `package.json`, `next.config.*`, `tsconfig.json`, root layout, and route-protection
  file (`proxy.ts` or `middleware.ts`).
- the gateway or reverse proxy, if one exists.

From the reference application, extract: the script names and their shape, how the port
is declared, how `basePath` or `assetPrefix` is set, the `transpilePackages` list, the
path aliases, the layout composition, and the file structure under `src/`.

## Step 2 — Ask the user

- Application name, URL prefix, and port. Propose the next free port; a port already
  claimed by another application is an error, not a warning.
- Which shared packages the application starts with.
- Whether the application requires authentication.

## Step 3 — Report divergences and let the user choose

Compare the host repository against `architecture.md`. For each difference that affects
the new application, present the choice explicitly rather than silently picking a side.
Typical divergences:

| Divergence | Follow the host | Follow the template |
| --- | --- | --- |
| Port declared in the dev script, not in an `mfe` key | Hard-code the port in the script | Add `mfe: { basePath, port }` and use `mfe-dev` |
| `assetPrefix` with a prefix-stripping proxy | Set `assetPrefix` only | Set Next.js `basePath` |
| Root scripts per application (`dev:<app>`) | Add the matching root scripts | Rely on `--filter` |
| `tsconfig` paths reaching into `../../packages` | Copy the alias block | Resolve through workspace links |
| Prebuilt shared stylesheet (`build:css`) | Wire the app into the existing pipeline | Import Tailwind in the app's `globals.css` |
| Application internals split by file type | Mirror the existing layout | Feature-first layout |

Default recommendation: follow the host repository, so the new application does not
become the odd one out. Say which you recommend and why, then do what the user chooses.

## Step 4 — Write the application

Use `files/app.md`, adjusted to the decisions from step 3. Files:

```
apps/<app>/
  package.json          name, mfe key, scripts, dependencies (catalog: / workspace:*)
  next.config.ts
  tsconfig.json
  postcss.config.mjs
  src/app/layout.tsx    application chrome
  src/app/page.tsx      placeholder landing page
  src/app/globals.css
  src/proxy.ts          only when the application requires authentication
  public/
```

If the application requires authentication, its `config.matcher` must list the bare `'/'`
alongside the catch-all — see the pitfall in `files/app.md`. Without it the application's
landing page is public while every deeper route redirects, and no static check notices.

## Step 5 — Register the application

- **Gateway.** If the gateway discovers applications from `apps/*/package.json`, nothing
  to do — verify only. If the routing table is hard-coded, add the route, including the
  WebSocket upgrade branch, in the same style as the existing entries.
- **Route registry.** Add the application's routes to the shared registry so the
  navigation shows them.
- **Compose.** Add a service for the application if `docker-compose.yml` exists.
- **AGENTS.md / README.md.** Add the application to the list of applications with its
  port and prefix.

## Step 6 — Verify

```bash
pnpm install
pnpm lint --filter=<app>
pnpm check-types --filter=<app>
pnpm build --filter=<app>
```

Then confirm routing end to end. Adding an application is precisely when prefix bugs
appear, and none of the three commands above can detect one:

```bash
pnpm dev --filter=<app> --filter=gateway
node <skill>/scripts/verify-routing.mjs --app <app>
```

Exit codes: `0` verified, `1` a check failed, `2` the checks could not be attributed.

**Start only the new application and the gateway.** With the catch-all application also
running, it answers a mis-routed prefix identically to the correct application, so a
broken prefix filter looks green; the verifier reports `INCONCLUSIVE` and exits 2 rather
than claiming a pass. The mis-route is only observable as a 503 naming the wrong
application, which requires the catch-all to be stopped.

Then re-run the verifier for each **pre-existing** application in the same isolated way. A
new prefix that over-matches steals traffic from its neighbours, and that damage shows up
on them, not on the application you just added.

## Step 7 — Report

List every file created and every file modified, plus the verification results. If the
user chose host conventions over the template anywhere, restate those choices so they
are visible in the transcript.
