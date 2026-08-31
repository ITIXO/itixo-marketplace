# Gateway

A workspace package that reverse-proxies every application under a single origin during
development. It has no per-application code: the routing table is derived from
`apps/*/package.json` at boot.

## gateway/package.json

```json
{
  "name": "gateway",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "index.js",
  "scripts": {
    "dev": "node index.js",
    "start": "node index.js",
    "lint": "biome check .",
    "lint:fix": "biome check --write ."
  },
  "dependencies": {
    "@repo/mfe": "workspace:*",
    "express": "<x.y.z>",
    "http-proxy-middleware": "<x.y.z>"
  }
}
```

## gateway/index.js

```js
import fs from 'node:fs';
import path from 'node:path';
import { loadApps } from '@repo/mfe/registry';
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

const port = Number(process.env.GATEWAY_PORT ?? 3000);
const errorTemplate = fs.readFileSync(path.join(import.meta.dirname, 'error.html'), 'utf-8');
const apps = loadApps(path.resolve(import.meta.dirname, '../apps'));

// Inside compose, applications are reached by service name rather than localhost.
const hostTemplate = process.env.APP_HOST_TEMPLATE ?? 'http://localhost:{port}';
const targetFor = (app) =>
  hostTemplate.replace('{port}', String(app.port)).replace('{name}', app.name);

const rewriteCookiePath = (proxyRes) => {
  const setCookie = proxyRes.headers['set-cookie'];
  if (!setCookie) return;
  proxyRes.headers['set-cookie'] = setCookie.map((cookie) => {
    const rewritten = cookie.replace(/Path=\/[^;]*/gi, 'Path=/');
    return /Path=/i.test(rewritten) ? rewritten : `${rewritten}; Path=/`;
  });
};

/**
 * Matches the application's own prefix and everything beneath it, and nothing else.
 * `/profile` must not match `/profiles`, so a bare `startsWith` is not enough.
 */
const matchesBasePath = (basePath) => (pathname) => {
  if (basePath === '/') return true;
  const path = pathname.split('?')[0];
  return path === basePath || path.startsWith(`${basePath}/`);
};

const createAppProxy = (app) => {
  const { name, basePath } = app;
  const target = targetFor(app);
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    ws: true,
    // The application owns its basePath, so the prefix must reach it unchanged.
    pathFilter: matchesBasePath(basePath),
    on: {
      proxyRes: rewriteCookiePath,
      error: (err, _req, res) => {
        if (typeof res.writeHead !== 'function') {
          res.destroy();
          return;
        }
        const unreachable = err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND';
        if (!res.headersSent) {
          res.writeHead(unreachable ? 503 : 502, {
            'Content-Type': 'text/html; charset=utf-8'
          });
        }
        res.end(
          unreachable
            ? errorTemplate.replaceAll('{{name}}', name).replaceAll('{{target}}', target)
            : `Proxy error for ${name}: ${err.message}`
        );
      }
    }
  });
};

// Longest prefix first so that "/" never shadows "/billing".
// The shell's catch-all is registered last; if a more specific filter fails to match,
// the shell silently swallows that application's traffic. See the pitfall note below.
const routes = [...apps]
  .sort((a, b) => b.basePath.length - a.basePath.length)
  .map((app) => ({ app, proxy: createAppProxy(app) }));

const server = express();
for (const { proxy } of routes) {
  server.use(proxy);
}

const listener = server.listen(port, () => {
  console.info(`Gateway listening on http://localhost:${port}`);
  for (const { app } of routes) {
    console.info(`  ${app.basePath.padEnd(16)} -> ${targetFor(app)} (${app.name})`);
  }
});

listener.on('upgrade', (req, socket, head) => {
  const url = req.url ?? '/';
  const match =
    routes.find(({ app }) => app.basePath !== '/' && matchesBasePath(app.basePath)(url)) ??
    routes.find(({ app }) => app.basePath === '/');
  match?.proxy.upgrade(req, socket, head);
});
```

## gateway/error.html

A minimal, self-contained page. `{{name}}` and `{{target}}` are substituted at request
time; the command shown must match the repository's actual filter syntax.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>{{name}} is not running</title>
    <style>
      body {
        font-family: ui-sans-serif, system-ui, sans-serif;
        margin: 0;
        display: grid;
        place-items: center;
        min-height: 100vh;
        background: #0b0d12;
        color: #e6e8ee;
      }
      main {
        max-width: 34rem;
        padding: 2rem;
      }
      h1 {
        font-size: 1.5rem;
        margin: 0 0 0.5rem;
      }
      p {
        color: #9aa3b2;
        line-height: 1.6;
      }
      code {
        display: block;
        margin-top: 1.25rem;
        padding: 0.85rem 1rem;
        border-radius: 0.5rem;
        background: #151922;
        color: #8ee6b8;
        font-size: 0.9rem;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>{{name}} is not running</h1>
      <p>
        The gateway could not reach <strong>{{target}}</strong>. Start the application and
        reload this page.
      </p>
      <code>pnpm dev --filter={{name}} --filter=gateway</code>
    </main>
  </body>
</html>
```

## On `changeOrigin`

`changeOrigin: true` rewrites the `Host` header to the target. It does **not** affect
whether a redirect leaks the application's internal port: middleware redirects come back
relative under either setting, because Next.js rewrites same-origin absolute redirects.
The port leak comes from route handlers instead — see the callback pitfall in
`files/app.md`.

Setting `changeOrigin: false` is a defensible deviation on the narrower ground that
`request.nextUrl.origin` should then be the gateway's, so future absolute-URL construction
(an identity provider's `redirect_uri`, a link in an email) does not carry `:3001`. It is
a deviation either way — record it in `AGENTS.md`, and do not justify it by the redirect
behaviour, which is unaffected.

## Pitfall: `pathFilter` must be a predicate, not a glob

`http-proxy-middleware` accepts glob strings in `pathFilter`, and earlier versions of this
template used `['/billing', '/billing/**']`. Under version 4 those globs do not match, and
the failure is silent and confusing: the request falls through to the shell's catch-all,
which returns the shell's 503 page naming the *wrong* application. Nothing in `pnpm lint`,
`pnpm check-types`, or `pnpm build` catches it, because the gateway is plain runtime code.

Use the `matchesBasePath` predicate above. It also closes a second hole a naive
`startsWith` leaves open: `/billing` must not capture `/billings`.

Always verify routing live — see the verification step in `bootstrap.md`.

## Production

The gateway is a development convenience. In production the ingress takes its place and
must implement the same three behaviours: prefix routing, WebSocket upgrade forwarding,
and cookies scoped to `/`. State this in the generated `AGENTS.md`.
