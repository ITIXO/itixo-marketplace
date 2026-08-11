---
name: add-package
description: Add a shared workspace package to this monorepo. Use when the user wants a new @repo/* package, or wants to promote code out of an application's src/shared.
---

# Add a shared package

Read `AGENTS.md` first: it holds the package boundaries this skill must preserve.

## Step 1 — Establish that it should exist

A new package is justified when:

- the code is needed by **two or more** applications, or
- it owns an **external boundary** — an API client, an identity provider, a logging sink.

Code used by a single application belongs in that application's `src/shared`. That
promotion path is the reason `src/shared` exists.

If the request does not meet the bar, say so, propose `src/shared` instead, and stop. The
user may still ask for the package — then create it.

Also check whether an existing package already owns the concern:

| Package | Owns |
| --- | --- |
| @repo/utils | Pure framework-agnostic functions. No React, no Next.js, no HTTP client. |
| @repo/lib | Runtime helpers that may depend on React and the HTTP client. |
| @repo/ui | Presentation. May depend on `@repo/lib` and `@repo/utils`. |
| @repo/auth | Session verification and route protection. |

## Step 2 — Ask the user

- Package name — it becomes `@repo/<name>`.
- One sentence on what it owns. This becomes the boundary statement in its README.
- Does it contain React components? This decides the tsconfig base and whether `react` is
  a peer dependency.
- Which applications consume it immediately.

## Step 3 — Write the package

    packages/<name>/
      package.json
      tsconfig.json
      README.md
      src/index.ts

`package.json` — consumed as source, no build step, no `dist`:

```json
{
  "name": "@repo/<name>",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*.ts"
  },
  "scripts": {
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "check-types": "tsc --noEmit"
  },
  "devDependencies": {
    "@repo/typescript-config": "workspace:*",
    "typescript": "catalog:"
  }
}
```

`tsconfig.json`:

```json
{
  "extends": "@repo/typescript-config/base.json",
  "include": ["src"],
  "exclude": ["node_modules"]
}
```

For a package containing components: export `./*` as `./src/*.tsx`, extend
`@repo/typescript-config/react-library.json`, and declare `react` as a peer dependency
resolved through `catalog:`.

A wildcard subpath only works when every exported file shares one extension. A package
mixing `.ts` and `.tsx` lists its subpaths explicitly, as `@repo/lib` does.

`README.md` states the boundary in two or three sentences: what belongs here, what does
not, and which packages it may depend on. This is what keeps the package from turning
into a second junk drawer.

## Step 4 — Wire the consumers

For each consuming application:

- add `"@repo/<name>": "workspace:*"` to its dependencies,
- add `'@repo/<name>'` to `transpilePackages` in its `next.config.ts`.

Any third-party dependency the package needs goes into the `catalog` block of
`pnpm-workspace.yaml` first, pinned to an exact version, and is referenced as `catalog:`.
Never a version range, never a second copy of a version.

## Step 5 — Verify

```bash
pnpm install
pnpm lint
pnpm check-types
```

At most three autonomous fix attempts on a failure. On the third, stop and report the
exact error.

## Step 6 — Report

List the files created, the applications wired, and any catalog entries added. Update the
package table in `AGENTS.md`.
