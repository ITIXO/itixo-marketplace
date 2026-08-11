# Shared packages

Every package is consumed as source: no build step, no `dist`, no watch mode. The only
exception is `@repo/mfe`, which is written in plain JavaScript because Node.js runs it
directly (the gateway and the `mfe-dev` binary import it without a bundler).

Common `package.json` skeleton, adjusted per package below:

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

Every package also gets:

```json
{
  "extends": "@repo/typescript-config/base.json",
  "include": ["src"],
  "exclude": ["node_modules"]
}
```

as `tsconfig.json` — `react-library.json` instead of `base.json` when it contains
components.

A wildcard subpath (`"./*": "./src/*.ts"`) only works when every exported file shares one
extension. A package that mixes `.ts` and `.tsx` lists its subpaths explicitly, as
`@repo/lib` does below.

A package containing `*.test.ts` files needs `"vitest": "catalog:"` in its
devDependencies. Its own `tsc --noEmit` type-checks those files, and pnpm's strict
`node_modules` will not resolve the root's copy.

---

## @repo/mfe

Owns the application registry. Plain JavaScript with JSDoc types.

`package.json`:

```json
{
  "name": "@repo/mfe",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "bin": {
    "mfe-dev": "./bin/mfe-dev.js"
  },
  "exports": {
    "./registry": "./src/registry.js",
    "./next": "./src/next.js"
  },
  "scripts": {
    "lint": "biome check .",
    "lint:fix": "biome check --write ."
  }
}
```

`src/registry.js`:

```js
import fs from 'node:fs';
import path from 'node:path';

/**
 * @typedef {{ name: string, basePath: string, port: number, dir: string }} MfeApp
 */

/** Reads the `mfe` block of a single application. */
export const readMfeConfig = (appDir) => {
  const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf-8'));
  if (!pkg.mfe) {
    throw new Error(`${pkg.name ?? appDir} has no "mfe" block in its package.json`);
  }
  const { basePath, port } = pkg.mfe;
  if (typeof basePath !== 'string' || !basePath.startsWith('/')) {
    throw new Error(`${pkg.name}: mfe.basePath must start with "/"`);
  }
  if (!Number.isInteger(port)) {
    throw new Error(`${pkg.name}: mfe.port must be an integer`);
  }
  return { name: pkg.name, basePath, port, dir: appDir };
};

/** Reads every application under `appsDir` and validates the registry as a whole. */
export const loadApps = (appsDir) => {
  const apps = fs
    .readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(appsDir, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'package.json')))
    .map(readMfeConfig);

  const byPort = new Map();
  const byBasePath = new Map();
  for (const app of apps) {
    const portOwner = byPort.get(app.port);
    if (portOwner) throw new Error(`Port ${app.port} claimed by ${portOwner} and ${app.name}`);
    byPort.set(app.port, app.name);

    const pathOwner = byBasePath.get(app.basePath);
    if (pathOwner) {
      throw new Error(`Prefix ${app.basePath} claimed by ${pathOwner} and ${app.name}`);
    }
    byBasePath.set(app.basePath, app.name);
  }
  return apps;
};
```

`src/next.js`:

```js
import fs from 'node:fs';
import path from 'node:path';
import { readMfeConfig } from './registry.js';

/** Walks up from `start` until the directory holding pnpm-workspace.yaml is found. */
const findRepoRoot = (start) => {
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
};

/**
 * Loads the repository's own `.env` into `process.env`.
 *
 * Next.js only reads `.env` from the application's own directory, and Turborepo does not
 * forward the root file either, so a single root `.env` otherwise reaches nothing:
 * `RuntimeEnvScript` serialises empty strings and `readPublicEnv()` throws for the first
 * caller. Real environment variables always win, so this changes nothing in a container —
 * which is what invariant 5 requires.
 */
const loadRootEnv = (start) => {
  const root = findRepoRoot(start);
  const file = root && path.join(root, '.env');
  if (!file || !fs.existsSync(file)) return;

  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    // An explicitly provided environment variable outranks the file.
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.trim().replace(/^(['"])(.*)\1$/, '$2');
  }
};

/**
 * Derives the Next.js routing configuration from the application's own `mfe` block,
 * so port and prefix are declared exactly once.
 */
export const withMfe = (config = {}) => {
  loadRootEnv(process.cwd());
  const { basePath } = readMfeConfig(process.cwd());
  return {
    ...config,
    ...(basePath === '/' ? {} : { basePath }),
    // Cast keeps the literal type, which NextConfig requires.
    output: /** @type {const} */ ('standalone')
  };
};
```

**Do not skip `loadRootEnv`.** Copying `.env.example` to `.env` at the repository root, as
bootstrap instructs, does not on its own make configuration reach an application: measured
in the served document, `window.__ENV={"API_URL":"","ENVIRONMENT":""}`. A bootstrap without
this loader is green only because nothing calls `readPublicEnv()` yet; the first caller
throws.

`next.config.ts` is evaluated for `next dev` and `next build`, but not by the standalone
`server.js`. That is the correct split: development reads the file, and a container is
given real environment variables.

The cast is not optional. Without it TypeScript widens `output` to `string`, and every
application's `next.config.ts` fails `check-types` with:

    Type 'string' is not assignable to type '"export" | "standalone" | undefined'

If the resolved TypeScript major no longer exposes the compiler API Next.js links against
— TypeScript 7 does not — `next build` fails with *"does not provide the compiler API
required by Next.js"*. Add the flag Next.js itself names, here rather than in each
application:

```js
    experimental: {
      ...config.experimental,
      // TypeScript 7 no longer exposes the compiler API Next.js links against, so the
      // build shells out to the tsc CLI instead.
      useTypeScriptCli: true
    }
```

Prefer this over downgrading TypeScript: `tsc --noEmit` in `check-types` still runs on the
resolved version, so type coverage is unchanged.

`bin/mfe-dev.js`:

```js
#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readMfeConfig } from '../src/registry.js';

const { port } = readMfeConfig(process.cwd());
const child = spawn(
  'next',
  ['dev', '--turbopack', '--port', String(port), ...process.argv.slice(2)],
  { stdio: 'inherit', shell: process.platform === 'win32' }
);
child.on('exit', (code) => process.exit(code ?? 0));
```

---

## @repo/typescript-config

No source, only JSON. `package.json` declares `"files": ["base.json", "react-library.json"]`
and no scripts.

`base.json`:

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "allowJs": true,
    "checkJs": false,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "incremental": true
  }
}
```

`react-library.json` extends it and adds `"types": ["react", "react-dom"]`. No `paths`
entries: workspace links do the resolution.

Two consequences of that `types` array, both of which surface as `check-types` failures:

- Every package extending `react-library.json` must declare **`@types/react-dom`** as a
  devDependency, not just `@types/react`. Otherwise: *"Cannot find type definition file
  for 'react-dom'"*.
- `types` is an allow-list, so `@types/node` is excluded even when installed. A package
  that touches `process` must widen it in its own `tsconfig.json`:

  ```json
  {
    "extends": "@repo/typescript-config/react-library.json",
    "compilerOptions": {
      "types": ["node", "react", "react-dom"]
    }
  }
  ```

  `@repo/lib` needs this, because `env.ts` and `RuntimeEnvScript.tsx` read `process.env`.

---

## @repo/tailwind-config

Holds the design tokens and the PostCSS configuration.

```json
{
  "name": "@repo/tailwind-config",
  "type": "module",
  "private": true,
  "exports": {
    ".": "./shared-styles.css",
    "./postcss": "./postcss.config.js"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "catalog:",
    "tailwindcss": "catalog:"
  }
}
```

`shared-styles.css` — the single place where brand tokens live:

```css
@theme {
  --color-brand-50: oklch(0.97 0.02 258);
  --color-brand-500: oklch(0.62 0.19 258);
  --color-brand-700: oklch(0.48 0.16 258);
  --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
  --radius-card: 0.75rem;
}
```

`postcss.config.js`:

```js
export default {
  plugins: {
    '@tailwindcss/postcss': {}
  }
};
```

There is no stylesheet build step. Each application compiles its own CSS and declares
`@source` over the packages it renders.

---

## @repo/utils

Framework-agnostic pure functions. **It ships empty on purpose.** `src/index.ts` contains
only an export marker, and `README.md` states the boundary:

> This package holds pure, framework-agnostic helpers. No React, no Next.js, no HTTP
> client, no application-specific logic. Anything that needs a runtime dependency belongs
> in `@repo/lib`; anything that renders belongs in `@repo/ui`; anything used by a single
> application belongs in that application's `src/shared`.

---

## @repo/lib

Runtime helpers. Depends on React, TanStack Query, and axios (all `catalog:`). Because it
mixes modules and components, its subpaths are listed explicitly:

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./env": "./src/env.ts",
    "./http": "./src/http.ts",
    "./routes": "./src/routes.ts",
    "./queryClient": "./src/queryClient.ts",
    "./QueryProvider": "./src/QueryProvider.tsx",
    "./RuntimeEnvScript": "./src/RuntimeEnvScript.tsx"
  }
}
```

`src/env.ts` — runtime configuration, never baked into the bundle:

```ts
export type PublicEnv = {
  API_URL: string;
  ENVIRONMENT: string;
};

declare global {
  interface Window {
    __ENV?: Partial<PublicEnv>;
  }
}

const PUBLIC_KEYS = ['API_URL', 'ENVIRONMENT'] as const satisfies readonly (keyof PublicEnv)[];

export const readPublicEnv = (): PublicEnv => {
  const source =
    typeof window === 'undefined'
      ? (process.env as Partial<Record<keyof PublicEnv, string>>)
      : (window.__ENV ?? {});

  const missing = PUBLIC_KEYS.filter((key) => !source[key]);
  if (missing.length > 0) {
    throw new Error(`Missing runtime configuration: ${missing.join(', ')}`);
  }
  return { API_URL: source.API_URL as string, ENVIRONMENT: source.ENVIRONMENT as string };
};

export const publicEnvKeys = PUBLIC_KEYS;
```

`src/RuntimeEnvScript.tsx` — a server component rendered in every root layout:

```tsx
import { publicEnvKeys } from './env';

/**
 * Serialises public configuration into the document at request time so a single
 * container image can be promoted across environments.
 */
export const RuntimeEnvScript = () => {
  const values = Object.fromEntries(publicEnvKeys.map((key) => [key, process.env[key] ?? '']));
  return (
    <script
      // biome-ignore lint/security/noDangerouslySetInnerHtml: values are serialised server-side from a fixed key list
      dangerouslySetInnerHTML={{ __html: `window.__ENV=${JSON.stringify(values)}` }}
    />
  );
};
```

`src/http.ts` — the shared axios instance:

```ts
import axios, { type AxiosInstance } from 'axios';
import { readPublicEnv } from './env';

export const createHttpClient = () => {
  const instance = axios.create({
    baseURL: readPublicEnv().API_URL,
    withCredentials: true,
    headers: { 'Content-Type': 'application/json' }
  });

  instance.interceptors.response.use(
    (response) => response,
    (error) => Promise.reject(error)
  );

  return instance;
};

let client: AxiosInstance | undefined;

/**
 * The shared client, created on first use. Creation is deferred rather than performed at
 * module scope so that importing this module during a build does not require the runtime
 * configuration to be present.
 */
export const getHttpClient = () => {
  client ??= createHttpClient();
  return client;
};
```

Do not export an eagerly constructed `http` instance. `readPublicEnv()` throws when
configuration is absent, so a module-scope instance turns any import of this module into a
build-time failure whenever `API_URL` is unset — exactly the situation in CI, and a direct
contradiction of invariant 5.

`src/queryClient.ts` and `src/QueryProvider.tsx`:

```ts
import { QueryClient } from '@tanstack/react-query';

export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: false
      }
    }
  });
```

```tsx
'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { createQueryClient } from './queryClient';

export const QueryProvider = ({ children }: { children: ReactNode }) => {
  const [client] = useState(createQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};
```

`src/routes.ts` — the cross-application route registry that drives navigation:

```ts
export type AppRoute = {
  /** Absolute path as seen through the gateway, including the application prefix. */
  path: string;
  /** Name of the owning application, matching its package name. */
  app: string;
  label: string;
  roles?: string[];
};

export const ROUTES: AppRoute[] = [
  { path: '/', app: 'shell', label: 'Overview' }
];

export const routesForApp = (app: string) => ROUTES.filter((route) => route.app === app);
```

---

## @repo/auth

Session verification shared by every application. Provider-agnostic: it validates a
signed session cookie and leaves token acquisition to the shell.

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./middleware": "./src/middleware.ts",
    "./session": "./src/session.ts",
    "./roles": "./src/roles.ts"
  },
  "dependencies": {
    "jose": "catalog:"
  },
  "peerDependencies": {
    "next": "catalog:"
  }
}
```

`jose` goes in the catalog like everything else: the shell also imports it directly, to
sign the session in its callback route, and invariant 4 allows a version exactly one home.

`src/session.ts` verifies the cookie with `jose` and returns `{ subject, roles }` or
`null`. `src/roles.ts` exposes `hasRole(session, roles)`.

`toGatewayPath` is not cosmetic. Concatenating `basePath` and `pathname` directly gives
`returnUrl=//` for the catch-all application, and `//login` for a nested path — and `//…`
is a **protocol-relative URL**. Any consumer that validates a return URL with
`startsWith('/')` will then happily redirect off-site, so the callback route must reject
`//` explicitly as well. For non-catch-all applications the same concatenation leaves a
stray trailing slash.

Tests for this package must opt out of the jsdom environment:

```ts
// @vitest-environment node
```

Under `environment: 'jsdom'`, signing a token fails with
*"payload must be an instance of Uint8Array"* — jsdom's `TextEncoder` returns a
`Uint8Array` from another realm, which jose's `instanceof` check rejects.

`src/middleware.ts`:

```ts
import { type NextRequest, NextResponse } from 'next/server';
import { readSession } from './session';

/**
 * Rebuilds the path as the gateway sees it. The application's own prefix is stripped from
 * `nextUrl.pathname`, so it has to be put back; the shell's prefix is `/`, which must not
 * produce a leading `//`.
 */
const toGatewayPath = (basePath: string, pathname: string) => {
  const prefix = basePath === '/' ? '' : basePath;
  const joined = `${prefix}${pathname}`;
  return joined.length > 1 ? joined.replace(/\/$/, '') : '/';
};

/**
 * Route protection for one application. `basePath` is the application's own prefix, so
 * redirects land on the gateway origin rather than the application's internal port.
 */
export const createAuthMiddleware =
  (basePath: string, requiredRoles: string[] = []) =>
  async (request: NextRequest) => {
    const session = await readSession(request.cookies);

    if (!session) {
      const login = new URL('/login', request.nextUrl.origin);
      login.searchParams.set('returnUrl', toGatewayPath(basePath, request.nextUrl.pathname));
      return NextResponse.redirect(login);
    }

    const authorised =
      requiredRoles.length === 0 || requiredRoles.some((role) => session.roles.includes(role));

    return authorised
      ? NextResponse.next()
      : NextResponse.redirect(new URL('/not-authorized', request.nextUrl.origin));
  };
```

---

## @repo/ui

Presentation, including the application chrome. Extends
`@repo/typescript-config/react-library.json`, declares `react` and `@repo/lib` as peer
dependencies, and exports components through a single wildcard because every file is a
component:

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*.tsx"
  }
}
```

`src/AppShell.tsx` renders the header and the navigation from the route registry:

```tsx
import type { AppRoute } from '@repo/lib/routes';
import Link from 'next/link';
import type { ReactNode } from 'react';

type AppShellProps = {
  routes: AppRoute[];
  /** Package name of the application rendering the shell. */
  currentApp: string;
  children: ReactNode;
};

export const AppShell = ({ routes, currentApp, children }: AppShellProps) => (
  <div className="flex min-h-screen">
    <nav className="w-60 shrink-0 border-r p-4">
      <ul className="space-y-1">
        {routes.map((route) => (
          <li key={route.path}>
            {/* Crossing an application boundary is a full document load through the gateway. */}
            {route.app === currentApp ? (
              <Link href={route.path}>{route.label}</Link>
            ) : (
              <a href={route.path}>{route.label}</a>
            )}
          </li>
        ))}
      </ul>
    </nav>
    <main className="flex-1 p-6">{children}</main>
  </div>
);
```

---

## @repo/logger (optional module)

Winston with a Seq sink on the server and a console fallback in the browser, selected
through the `browser` field in `package.json`:

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./server": "./src/server.ts",
    "./client": "./src/client.ts"
  },
  "browser": {
    "./src/server.ts": false,
    "winston": false,
    "@datalust/winston-seq": false
  }
}
```

The service name comes from the application, not from a build-time variable.

Files: `src/types.ts` (`LogLevel`, `LogContext`, `Logger`), `src/server.ts`
(`createServerLogger(service)` — winston plus a Seq transport added only when
`SEQ_SERVER_URL` is set), `src/client.ts` (`createClientLogger(service)` — console).

**`src/index.ts` must not re-export `./server`.** The `browser` field only replaces the
module when a bundler honours it; a barrel that pulls `winston` into a shared entry point
drags a Node-only dependency toward the client bundle. Export the client logger and the
types only, and let server code import `@repo/logger/server` explicitly:

```ts
export { createClientLogger } from './client';
export type { LogContext, Logger, LogLevel } from './types';
```

## @repo/i18n (optional module)

Shared i18next initialisation plus one translation namespace per application, so two
applications cannot collide on a key.

`src/resources.ts` owns the namespaces and exports the `Namespace` union, so adding an
application without adding its namespace is a type error:

```ts
export const resources = {
  en: {
    common: { signIn: 'Sign in', signOut: 'Sign out' },
    shell: { title: 'Overview' },
    billing: { title: 'Billing' }
  }
} as const;

export type Namespace = keyof (typeof resources)['en'];
export const defaultLanguage = 'en';
```

`src/config.ts` exports `createI18n(namespace, language?)`, which returns an **isolated
instance** via `i18next.createInstance()` — never the shared singleton, which would leak
one application's default namespace into another. It sets `ns: [namespace, 'common']`,
`defaultNS: namespace`, and `fallbackNS: 'common'`.

`src/I18nProvider.tsx` is the App Router entry point: a `'use client'` component that
builds the instance once in `useState` and renders `I18nextProvider`. Applications wrap
their layout in `<I18nProvider namespace="billing">`; client components then use
`useTranslation()` from `react-i18next` as normal. Without this provider the hook has no
instance to bind to, which is the failure mode a prose-only description invites.

## @repo/api-types (optional module)

Types generated from the backend OpenAPI schema.

```json
{
  "scripts": {
    "gen": "openapi-typescript $OPENAPI_URL -o ./src/schema.d.ts"
  }
}
```

`src/schema.d.ts` is generated output: never edit it by hand, and say so in the package
README.
