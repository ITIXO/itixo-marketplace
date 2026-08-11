# Mode: bootstrap

Creates a complete monorepo in an empty target directory.

## Step 1 — Ask everything at once

Ask these questions in a single batch. Do not drip-feed them.

| Question | Notes |
| --- | --- |
| Target directory | Absolute or `~`-relative path, for example `~/Projects/acme-portal`. |
| Repository name | Defaults to the target directory's basename. |
| Applications | Comma-separated list. The first one is the shell unless the user says otherwise, for example `shell, billing, crm`. |
| URL prefixes | Offer the derived defaults (`/` for the shell, `/<name>` for the rest) and accept overrides. |
| Optional modules | `i18n`, `logger`, `api-types`. `api-types` additionally needs the OpenAPI schema URL; skip the module if the user has none yet. |

Default the optional modules **on for a company monorepo, off for a small or exploratory
one**. Each adds packages, catalog entries, and wiring to every application; a request for
"a simple app with two pages" is not served by three modules it will not use. Say which
default you applied so the user can override it.

Assign ports automatically: the shell gets 3001, each further application the next free
port upward. The gateway always takes 3000.

## Step 2 — Verify the target is safe

Stop and ask again if any of the following holds:

- the directory exists and is not empty,
- the path lies inside the repository this skill is running from,
- the path lies inside another git working tree.

Otherwise create the directory.

## Step 3 — Resolve the current versions

The catalog pins exact versions, and this skill installs the newest release of each
dependency **that satisfies `minimumReleaseAge`**. Those two requirements conflict:
`pnpm-workspace.yaml` sets a 7-day quarantine, so pinning today's `latest` makes
`pnpm install` fail outright with a list of packages "within the minimumReleaseAge
cutoff". A bare `npm view <pkg> version` is therefore the wrong tool.

Do not hand-roll this. Run the shipped resolver, which selects the highest semver version
published before the cutoff and emits a ready-to-paste catalog block:

```bash
node <skill>/scripts/resolve-versions.mjs --yaml \
  --with-i18n --with-logger --with-api-types    # only the modules actually selected
```

Add `--release-age-minutes N` if you changed `minimumReleaseAge`, `--json` for machine
output, or no flag for `name version` lines. It exits 1 if any package has no stable
release old enough, which is a signal to stop rather than improvise.

The resolver sorts by **semver, never by publish date**. Maintained release lines get
backports, so date ordering silently selects the wrong major — `express` 4.x over 5.x,
`@types/node` 22.x over 26.x, `@types/react` 18.x over 19.x.

Do not consult external documentation for these versions. If a resolved combination
fails to build in step 6, the loop breaker in step 7 applies.

Record the resolved Node.js and pnpm versions too: write the local `node --version` into
`.nvmrc` and the local `pnpm --version` into the root `packageManager` field.

## Step 4 — Write the files

Write in this order, taking literal contents from the referenced files:

1. Root configuration — `files/root.md`: `package.json`, `pnpm-workspace.yaml`,
   `turbo.json`, `biome.json`, `vitest.config.ts`, `.npmrc`, `.nvmrc`, `.gitignore`,
   `.dockerignore`, `.env.example`.
2. Shared packages — `files/packages.md`, in dependency order: `mfe`,
   `typescript-config`, `tailwind-config`, `utils`, `lib`, `logger`, `auth`, `ui`, then
   the optional `i18n` and `api-types`.
3. Gateway — `files/gateway.md`.
4. Applications — `files/app.md`, once per application. The shell additionally receives
   the `login`, `callback`, and `not-authorized` routes described there.
5. Docker — `files/docker.md`: `docker/Dockerfile.app`, `docker-compose.yml`, with one
   compose service per application plus the gateway.
6. Documentation and embedded skills — `files/docs.md`: `AGENTS.md`, `CLAUDE.md`,
   `README.md`, and `.claude/skills/add-app/SKILL.md` plus
   `.claude/skills/add-package/SKILL.md` so the new repository can extend itself.

Only include a package in an application's `transpilePackages` list and dependencies if
that application actually uses it.

## Step 5 — Install, configure, and initialise git

```bash
cd <target>
pnpm install
pnpm exec biome migrate --write

cp .env.example .env
node -e "const fs=require('node:fs'),c=require('node:crypto');
  fs.writeFileSync('.env', fs.readFileSync('.env','utf8').replace(
    /^AUTH_SESSION_SECRET=.*\$/m,
    'AUTH_SESSION_SECRET=' + c.randomBytes(32).toString('base64url')))"

git init
```

Three things happen here that must not be deferred:

- **`biome migrate`** reconciles `biome.json` with the Biome version actually installed,
  instead of guessing which keys that release deprecated. Run it every time.
- **`AUTH_SESSION_SECRET` gets a generated value.** Shipped empty, the callback route
  throws on the first sign-in and `/callback` returns 500 — in a repository whose gate is
  otherwise green, because nothing else exercises it.
- **`git init` runs now, not at the end.** Biome's `vcs.useIgnoreFile` only takes effect
  inside a git working tree, so `pnpm lint` behaves differently without one. The *commit*
  still happens after the gate passes, in step 8.

## Step 6 — Verification gate

Run all four, in this order, and report the real result:

```bash
pnpm lint
pnpm check-types
pnpm build
pnpm test
```

`pnpm test` is part of the gate, so the repository must ship with tests. Vitest exits 1 on
"No test files found", and a bootstrap that leaves `pnpm test` red is not finished. Seed a
few that assert real invariants rather than placeholders — `routesForApp` filtering,
`readPublicEnv` naming its missing keys, `hasRole` semantics.

Two traps when writing them, both documented where they bite:

- A package needs `"vitest": "catalog:"` in its devDependencies before it gets a test, and
  so does an **application** — the root config includes `apps/*`, so an app test otherwise
  passes `pnpm test` and then breaks that app's `tsc --noEmit`.
- Anything signing a token with `jose` needs a `// @vitest-environment node` docblock;
  under jsdom it fails on `instanceof Uint8Array`.

### Step 6b — Verify routing live

**This step is not optional, and the three checks above cannot replace it.** The gateway,
the proxy middleware, and the prefix filters are runtime code; every routing bug found
while building this template passed lint, type-check, and build cleanly.

Run the shipped verifier **once per application**, with only that application and the
gateway started:

```bash
pnpm dev --filter=<app> --filter=gateway         # background it
node <skill>/scripts/verify-routing.mjs --app <app> --repo <target>
```

Exit codes: `0` verified, `1` a check failed, `2` the checks could not be attributed.

**Start one application at a time, and do not shortcut this with a full `pnpm dev`.**
While the catch-all application runs, it answers a mis-routed prefix *exactly* as the
correct application would — same status, same redirect, same `returnUrl`, because the
middleware faithfully rebuilds the gateway-visible path either way. A broken prefix filter
then looks green. Only with the catch-all stopped does the mis-route surface, as a 503
naming the wrong application. The verifier knows this: it reports `INCONCLUSIVE` and exits
2 rather than claiming a pass it cannot justify.

What it checks, and what each catches:

| Check | Catches |
| --- | --- |
| answers own prefix | prefix filter never matching, so the catch-all swallows the route |
| index protected | the `matcher` missing its bare `'/'` entry |
| redirect stays on gateway | middleware redirects leaking the internal port |
| login page reachable | session entry points not excluded from the shell's matcher, so sign-in loops forever |
| callback stays on gateway | a route handler building an absolute URL from `request.nextUrl.origin` |
| deep route reaches app | prefix matching the index only |
| no prefix over-match | `/billing` capturing `/billings` |

The last four exist because each one shipped broken at least once while every other check
stayed green. Treat a new check here as cheaper than the incident it prevents.

Stop the dev servers before continuing.

## Step 7 — Loop breaker

A failure gets at most three autonomous fix attempts. Prefer fixing forward.

When a tool's own error message names the remedy, take it before reaching for a
downgrade — `next build` failing on the TypeScript compiler API names
`experimental.useTypeScriptCli`, and that keeps the resolved TypeScript version in
`check-types`. If a newly released version is the cause and three attempts did not resolve
it, pin that single dependency one minor version back, note the pin in the final report,
and continue. After the third failed attempt on the same error, stop and report.

## Step 8 — Commit

The repository was already initialised in step 5, so this is only the first commit, made
once the gate is green:

```bash
cd <target> && git add -A && git commit -m "chore: bootstrap monorepo"
```

Before committing, check what `git add -A` actually staged. Editor directories
(`.idea/`, `.vscode/`) appear in a directory that looked empty at step 2. Confirm `.env`
is **not** staged and `.env.example` is.

## Step 9 — Report

State plainly what exists, what was verified, and what was not. Then show how to work
with it:

```bash
pnpm dev                                     # every application behind the gateway
pnpm dev --filter=billing --filter=gateway   # a single application
open http://localhost:3000
```

Report every deviation from this template, with the reason — version pins moved back for
`minimumReleaseAge`, flags added to work around a tool, anything the template said that
turned out to be wrong. The next person to run this skill needs that list.

Finally, list the follow-ups the user still owns: the identity provider behind
`@repo/auth`, the API base URL in `.env`, and the design tokens in
`packages/tailwind-config`. Be explicit that the generated `callback` route issues a
development session for a fixed subject and is not a real sign-in.
