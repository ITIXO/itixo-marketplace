# Mode: add-package

Adds one shared workspace package.

## Step 1 — Establish that it should exist

A new package is justified when code is needed by two or more applications, or when it
owns an external boundary (an API client, an identity provider, a logging sink). Code
used by a single application belongs in that application's `src/shared`.

If the request does not meet that bar, say so, propose `src/shared` instead, and stop.
The user may still ask for the package, in which case create it.

## Step 2 — Ask the user

- Package name (it becomes `@repo/<name>`).
- One sentence on what it owns, which becomes the boundary statement in its README.
- Does it contain React components? This decides the tsconfig base and whether `react`
  is a peer dependency.
- Which applications will consume it immediately.

## Step 3 — Write the package

```
packages/<name>/
  package.json
  tsconfig.json
  README.md
  src/index.ts
```

`package.json` — source-only, no build step:

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

For a package containing components, export `./*` as `./src/*.tsx`, extend
`@repo/typescript-config/react-library.json`, and declare `react` as a peer dependency
resolved through `catalog:`.

`tsconfig.json`:

```json
{
  "extends": "@repo/typescript-config/base.json",
  "include": ["src"],
  "exclude": ["node_modules"]
}
```

`README.md` states the boundary in two or three sentences: what belongs here, what does
not, and which packages it may depend on. This is what keeps the package from turning
into a second junk drawer.

## Step 4 — Wire the consumers

For each consuming application:

- add `"@repo/<name>": "workspace:*"` to its dependencies,
- add `'@repo/<name>'` to `transpilePackages` in its `next.config.ts`.

Any third-party dependency the package needs goes into the root catalog first, pinned
exactly, and is referenced as `catalog:`.

## Step 5 — Verify

```bash
pnpm install
pnpm check-types
pnpm lint
```

## Step 6 — Report

List the files created, the applications wired, and any catalog entries added.
