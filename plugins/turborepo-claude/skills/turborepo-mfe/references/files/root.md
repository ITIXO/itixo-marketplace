# Root configuration files

Placeholders: `<repo>` repository name, `<node>` local Node.js version, `<pnpm>` local
pnpm version, `<x.y.z>` the version resolved in bootstrap step 3.

## package.json

```json
{
  "name": "<repo>",
  "private": true,
  "packageManager": "pnpm@<pnpm>",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "check-types": "turbo run check-types",
    "test": "vitest run"
  },
  "devDependencies": {
    "@biomejs/biome": "catalog:",
    "@testing-library/dom": "catalog:",
    "@testing-library/react": "catalog:",
    "@types/node": "catalog:",
    "@vitejs/plugin-react": "catalog:",
    "jsdom": "catalog:",
    "turbo": "catalog:",
    "typescript": "catalog:",
    "vite-tsconfig-paths": "catalog:",
    "vitest": "catalog:"
  }
}
```

**Every entry is `catalog:`, with no exceptions.** The root `package.json` resolves
`catalog:` like any other workspace, so a literal version here is simply a second home for
something invariant 4 says has exactly one — and `scripts/resolve-versions.mjs` emits all
of these into the catalog anyway.

Nothing else may be added here. Per-application commands are expressed with
`--filter`, never as extra scripts.

## pnpm-workspace.yaml

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "gateway"

# Delay adoption of freshly published releases (7 days) as supply-chain protection.
minimumReleaseAge: 10080

# Postinstall scripts are blocked by default. sharp is Next.js's image optimiser and
# needs its native binary; nothing else is allowed to run a build script.
allowBuilds:
  sharp: true

# Only for transitive conflicts. Direct dependencies use the catalog.
overrides:
  react: "<x.y.z>"
  react-dom: "<x.y.z>"

catalog:
  "@biomejs/biome": "<x.y.z>"
  "@tailwindcss/postcss": "<x.y.z>"
  "@tanstack/react-query": "<x.y.z>"
  "@types/node": "<x.y.z>"
  "@types/react": "<x.y.z>"
  "@types/react-dom": "<x.y.z>"
  axios: "<x.y.z>"
  next: "<x.y.z>"
  react: "<x.y.z>"
  react-dom: "<x.y.z>"
  tailwindcss: "<x.y.z>"
  typescript: "<x.y.z>"
```

The catalog lists what the template actually installs. Do not seed speculative entries: a
package nothing depends on is cruft in every repository generated from here.

Add `i18next` and `react-i18next` when the i18n module is selected, `winston` and
`@datalust/winston-seq` when the logger module is selected, and `openapi-typescript`
when the api-types module is selected. Every entry is an exact version — no ranges.

`jose`, `express`, `http-proxy-middleware`, and `vitest` belong here too. Invariant 4
gives a version exactly one home; a literal version in a package's `package.json` is a
second home and will drift.

Two pnpm behaviours matter here, and both are fatal to `pnpm install` if unhandled:

- **`allowBuilds` is a map, not a list.** pnpm 11 rewrites the older
  `onlyBuiltDependencies:` array into `allowBuilds:` with the placeholder value
  `set this to true or false`, and installs keep failing until you replace it. Write the
  map form directly. Without it, `pnpm install` exits 1 on `ERR_PNPM_IGNORED_BUILDS`.
- **`minimumReleaseAge` fights exact pins.** See bootstrap step 3: resolve versions
  against the cutoff, never with a bare `npm view <pkg> version`.

## turbo.json

```json
{
  "$schema": "https://turborepo.com/schema.json",
  "ui": "tui",
  "globalDependencies": ["biome.json", ".env"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["$TURBO_DEFAULT$", ".env*"],
      "outputs": [".next/**", "!.next/cache/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {},
    "check-types": {},
    "test": {
      "outputs": ["coverage/**"]
    }
  },
  "globalEnv": ["NODE_ENV"]
}
```

Public configuration is read at runtime, so `globalEnv` stays almost empty. Adding a
`NEXT_PUBLIC_*` variable here is a signal that invariant 5 is being broken.

## biome.json

```json
{
  "$schema": "https://biomejs.dev/schemas/<x.y.z>/schema.json",
  "root": true,
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "ignoreUnknown": true
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100,
    "lineEnding": "lf"
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "semicolons": "always",
      "trailingCommas": "none",
      "arrowParentheses": "always"
    }
  },
  "css": {
    "parser": {
      "tailwindDirectives": true
    }
  },
  "html": {
    "parser": {
      "interpolation": true
    }
  },
  "assist": {
    "enabled": true,
    "actions": {
      "source": {
        "organizeImports": "on"
      }
    }
  },
  "linter": {
    "enabled": true,
    "domains": {
      "react": "recommended",
      "next": "recommended",
      "test": "recommended"
    },
    "rules": {
      "preset": "recommended",
      "style": {
        "noNonNullAssertion": "off"
      },
      "correctness": {
        "noUnusedVariables": {
          "level": "warn",
          "options": {
            "ignoreRestSiblings": true
          }
        }
      },
      "suspicious": {
        "noConsole": {
          "level": "warn",
          "options": {
            "allow": ["warn", "error", "info", "debug"]
          }
        }
      },
      "nursery": {
        "useSortedClasses": {
          "level": "warn",
          "options": {
            "attributes": ["classList"],
            "functions": ["cn", "clsx", "cva", "tw"]
          }
        }
      }
    }
  },
  "overrides": [
    {
      "includes": ["**/*.css"],
      "linter": {
        "rules": {
          "suspicious": {
            "noUnknownAtRules": "off"
          },
          "complexity": {
            "noImportantStyles": "off"
          }
        }
      }
    }
  ]
}
```

The schema URL must match the resolved Biome version.

Three settings above exist because of concrete failures, not preference:

- **`css.parser.tailwindDirectives`** — without it every application's `globals.css`
  fails to parse on `@source` and `@theme`, which aborts formatting for the whole file.
- **`html.parser.interpolation`** — the gateway's `error.html` uses `{{name}}` and
  `{{target}}` placeholders, which Biome otherwise rejects as unsupported text
  expressions.
- **`rules.preset`** — `"recommended": true` is deprecated and prints a migration notice
  on every run. If a newer Biome deprecates something else, run `biome migrate --write`.

Biome's CSS formatter normalises strings to double quotes; that is expected and differs
from the JavaScript `quoteStyle` above.

## vitest.config.ts

```ts
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['{apps,packages}/*/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/.next/**']
  }
});
```

## .npmrc

```
registry=https://registry.npmjs.org
```

Add a scoped registry line only when the user names a private registry.

## .nvmrc

```
v<node>
```

## .gitignore

```
node_modules/
.next/
out/
dist/
.turbo/
coverage/
*.tsbuildinfo
next-env.d.ts
.env
.env.local
.DS_Store
.idea/
.vscode/
```

`next-env.d.ts` is generated by `next build` and carries a "should not be edited" banner,
yet Biome reformats its quotes — so an unignored copy makes `pnpm lint` fail immediately
after the first build. Since `vcs.useIgnoreFile` is on, ignoring it here also removes it
from Biome's scope. Editor directories are ignored for the same reason: `git add -A`
otherwise sweeps them into the bootstrap commit.

## .dockerignore

```
node_modules
.next
.turbo
.git
coverage
**/node_modules
**/.next
**/.turbo
```

## .env.example

```
# Consumed by the gateway
GATEWAY_PORT=3000

# Injected into the browser at runtime as window.__ENV
API_URL=http://localhost:5000
ENVIRONMENT=local

# Session verification in @repo/auth
AUTH_ISSUER=
AUTH_CLIENT_ID=
AUTH_COOKIE_NAME=session
AUTH_SESSION_SECRET=

# Structured logging sink for @repo/logger
SEQ_SERVER_URL=
SEQ_API_KEY=

# Source schema for `pnpm --filter @repo/api-types gen`
OPENAPI_URL=
```

Include only the blocks whose modules were selected. Copy this to `.env` during bootstrap
so the repository starts in a runnable state.
