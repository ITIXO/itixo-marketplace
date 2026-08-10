# A single application

Placeholders: `<app>` package name (`billing`), `<prefix>` URL prefix (`/billing`, or `/`
for the shell), `<port>` assigned port.

```
apps/<app>/
  package.json
  next.config.ts
  tsconfig.json
  postcss.config.mjs
  src/
    app/
      layout.tsx
      page.tsx
      globals.css
    features/
    shared/
    proxy.ts
  public/
```

## package.json

```json
{
  "name": "<app>",
  "version": "0.0.0",
  "private": true,
  "mfe": {
    "basePath": "<prefix>",
    "port": <port>
  },
  "scripts": {
    "dev": "mfe-dev",
    "build": "next build",
    "start": "next start",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "check-types": "tsc --noEmit"
  },
  "dependencies": {
    "@repo/auth": "workspace:*",
    "@repo/lib": "workspace:*",
    "@repo/ui": "workspace:*",
    "@tanstack/react-query": "catalog:",
    "axios": "catalog:",
    "next": "catalog:",
    "react": "catalog:",
    "react-dom": "catalog:"
  },
  "devDependencies": {
    "@repo/mfe": "workspace:*",
    "@repo/tailwind-config": "workspace:*",
    "@repo/typescript-config": "workspace:*",
    "@tailwindcss/postcss": "catalog:",
    "@types/node": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "tailwindcss": "catalog:",
    "typescript": "catalog:"
  }
}
```

`mfe.basePath` and `mfe.port` are the single source of truth. No port appears in any
script, and `--filter=<app>` is the only way an application is addressed from the root.

## next.config.ts

```ts
import { withMfe } from '@repo/mfe/next';
import type { NextConfig } from 'next';

const config: NextConfig = withMfe({
  // Workspace packages are consumed as TypeScript source.
  transpilePackages: ['@repo/ui', '@repo/lib', '@repo/auth']
});

export default config;
```

`withMfe` supplies `basePath` from the `mfe` block and `output: 'standalone'` for the
container image. Do not set `assetPrefix`: `basePath` already prefixes assets, and the
gateway forwards the prefix unchanged.

Keep this list in sync with `dependencies`: a package belongs in `transpilePackages`
**and** in `dependencies`, or in neither.

`@repo/utils` is deliberately absent from both. It ships empty, so an application cannot
yet use it, and listing it would contradict the rule that a package appears only where it
is actually used. Add it to both lists at the moment the first helper lands there.

## tsconfig.json

```json
{
  "extends": "@repo/typescript-config/react-library.json",
  "compilerOptions": {
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`@/*` is the only alias. Workspace packages resolve through pnpm links.

## postcss.config.mjs

```js
export { default } from '@repo/tailwind-config/postcss';
```

## src/app/globals.css

```css
@import 'tailwindcss';
@import '@repo/tailwind-config';

/* Tailwind must scan the shared packages this application renders. */
@source '../../../../packages/ui/src';
```

## src/app/layout.tsx

```tsx
import './globals.css';
import { QueryProvider } from '@repo/lib/QueryProvider';
import { RuntimeEnvScript } from '@repo/lib/RuntimeEnvScript';
import { ROUTES } from '@repo/lib/routes';
import { AppShell } from '@repo/ui/AppShell';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: '<App title>'
};

const RootLayout = ({ children }: { children: ReactNode }) => (
  <html lang="en">
    <head>
      <RuntimeEnvScript />
    </head>
    <body>
      <QueryProvider>
        <AppShell routes={ROUTES} currentApp="<app>">
          {children}
        </AppShell>
      </QueryProvider>
    </body>
  </html>
);

export default RootLayout;
```

## src/app/page.tsx

```tsx
const Page = () => (
  <section>
    <h1 className="font-semibold text-2xl">&lt;app&gt;</h1>
    <p className="text-slate-500">Replace this page with the first feature.</p>
  </section>
);

export default Page;
```

## src/proxy.ts

Next.js runs this file for every matching request; it is where the application enforces
authentication. Omit it for a public application.

```ts
import { createAuthMiddleware } from '@repo/auth/middleware';

export const proxy = createAuthMiddleware('<prefix>');

export const config = {
  // '/' is listed separately: the catch-all group below requires at least one character
  // after the slash, so it would leave the index route unprotected.
  matcher: ['/', '/((?!api|_next/|favicon\\.ico|robots\\.txt|sitemap\\.xml).*)']
};
```

**Never omit the bare `'/'` entry.** Next.js compiles the matcher with path-to-regexp,
where a group is required and matches at least one character, so
`'/((?!...).*)'` alone does **not** match `/`. Since the application's own `basePath` is
stripped before the matcher runs, `/` *is* the application's landing page — omitting the
entry leaves exactly that page public while every deeper route redirects correctly. Lint,
type-check, and build all pass. Verify it with a real request instead.

In a repository that still uses the earlier convention, this file is `middleware.ts` and
exports `middleware` instead. Follow whatever the reference application does.

## Shell-only routes

The application with `basePath: "/"` additionally owns the session entry points, because
they must live on a stable, unprefixed path:

```
src/app/login/page.tsx            starts the sign-in flow, honours ?returnUrl
src/app/callback/route.ts         exchanges the provider response for the session cookie
src/app/not-authorized/page.tsx   shown when a role check fails
```

### The shell's matcher must exclude those three paths

**This is the single most damaging way to follow this template literally.** The catch-all
group above matches `/login`, so the shell's own middleware redirects `/login` to `/login`:

```
GET /login  ->  307  Location: /login?returnUrl=%2Flogin      (and again, forever)
```

There is then no way to obtain a session, and the repository is unusable — while every
other routing check still passes, because a redirect is exactly what they expect to see.
The shell's matcher therefore reads:

```ts
export const config = {
  // The session entry points live on this application and must stay reachable without a
  // session, otherwise sign-in redirects to itself.
  matcher: [
    '/',
    '/((?!api|_next/|login|callback|not-authorized|favicon\\.ico|robots\\.txt|sitemap\\.xml).*)'
  ]
};
```

`scripts/verify-routing.mjs` checks this ("login page reachable") by following the
redirect once and asserting the destination renders instead of redirecting again.

### The callback route

`files/packages.md` establishes the middleware idiom
`NextResponse.redirect(new URL(path, request.nextUrl.origin))`. **In a route handler that
idiom is wrong**, and reusing it here is the natural mistake:

```
GET http://localhost:3000/callback?returnUrl=%2Fbilling
  ->  307  Location: http://localhost:3001/billing        # the shell's internal port
```

`request.nextUrl.origin` is the application's own origin regardless of the `Host` header
it received. Middleware escapes this only because Next.js rewrites a same-origin absolute
redirect to a relative `Location` — so the two look identical in source and behave
differently. A route handler must emit a relative `Location` itself:

```ts
const safeReturnUrl = (value: string | null) => {
  // '//evil.example' is protocol-relative: rejecting it is what keeps this from
  // becoming an open redirect.
  if (!value?.startsWith('/') || value.startsWith('//')) return '/';
  return value;
};

const response = new NextResponse(null, {
  status: 307,
  headers: { Location: safeReturnUrl(request.nextUrl.searchParams.get('returnUrl')) }
});

response.cookies.set(sessionCookieName(), token, {
  path: '/',
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 60 * 60 * 8
});
```

The session cookie is set with `Path=/`, `HttpOnly`, `SameSite=Lax`, and `Secure` outside
development, so every application behind the gateway sees the same session.

State plainly in `AGENTS.md` that this route issues a development session and is not a
real sign-in until the provider exchange replaces it.

## Tests inside an application

The root `vitest.config.ts` includes `apps/*`, but the `package.json` above has no
`vitest` entry. An application test therefore passes `pnpm test` and then breaks that
application's `tsc --noEmit`. Add `"vitest": "catalog:"` to its devDependencies before
writing the first test — the same rule that applies to packages.
