#!/usr/bin/env node
/**
 * Verifies gateway routing and route protection with real requests.
 *
 * `pnpm lint`, `pnpm check-types`, and `pnpm build` cannot detect either of the failures
 * this script exists for, because both are runtime behaviour:
 *
 *   1. A prefix filter that never matches. The request falls through to the shell's
 *      catch-all, and the 503 page names the *shell* — pointing at the wrong component.
 *   2. An auth `matcher` missing its bare '/' entry. Every deep route redirects
 *      correctly while the application's landing page stays public.
 *
 * Run it against a live gateway:
 *
 *   pnpm dev --filter=<app> --filter=gateway     # in another terminal
 *   node verify-routing.mjs                      # every running application
 *   node verify-routing.mjs --app profile        # just one
 *   node verify-routing.mjs --gateway http://localhost:3000 --repo /path/to/repo
 *
 * Exit codes: 0 all checks passed, 1 a check failed, 2 could not run the checks.
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};

const repo = path.resolve(value('--repo', process.cwd()));
const gateway = (value('--gateway', 'http://localhost:3000') ?? '').replace(/\/$/, '');
const onlyApp = value('--app', null);

const appsDir = path.join(repo, 'apps');
if (!fs.existsSync(appsDir)) {
  console.error(`No apps directory at ${appsDir}. Pass --repo <path>.`);
  process.exit(2);
}

const readApps = () =>
  fs
    .readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(appsDir, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'package.json')))
    .map((dir) => {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
      if (!pkg.mfe) throw new Error(`${pkg.name ?? dir} has no "mfe" block`);
      return {
        name: pkg.name,
        basePath: pkg.mfe.basePath,
        port: pkg.mfe.port,
        // An application enforces authentication when it ships a route-protection file.
        protected: ['src/proxy.ts', 'src/middleware.ts', 'proxy.ts', 'middleware.ts'].some(
          (candidate) => fs.existsSync(path.join(dir, candidate))
        ),
        // The application owning the session entry points, normally the shell.
        hasCallback: ['src/app/callback/route.ts', 'app/callback/route.ts'].some((candidate) =>
          fs.existsSync(path.join(dir, candidate))
        )
      };
    });

const allApps = readApps();
const catchAll = allApps.find((app) => app.basePath === '/') ?? null;
const apps = allApps.filter((app) => !onlyApp || app.name === onlyApp);
if (apps.length === 0) {
  console.error(onlyApp ? `No application named "${onlyApp}".` : 'No applications found.');
  process.exit(2);
}

const probe = async (url) => {
  const response = await fetch(url, { redirect: 'manual' });
  const body = response.status >= 500 ? await response.text() : '';
  return {
    status: response.status,
    location: response.headers.get('location'),
    // The gateway's 503 page names the application it could not reach. That name is the
    // single most useful attribution signal when routing is wrong.
    unreachable: body.match(/<h1>([^<]+) is not running<\/h1>/)?.[1] ?? null
  };
};

try {
  await fetch(gateway, { redirect: 'manual' });
} catch (error) {
  console.error(`Cannot reach the gateway at ${gateway}: ${error.cause?.code ?? error.message}`);
  console.error('Start it with:  pnpm dev --filter=<app> --filter=gateway');
  process.exit(2);
}

const results = [];
const record = (app, check, verdict, detail) => results.push({ app, check, verdict, detail });

/**
 * Prefix attribution depends on the catch-all being down.
 *
 * When a prefix filter fails to match, the catch-all serves the request instead — and its
 * response is indistinguishable from the correct one: both redirect unauthenticated
 * traffic to /login with the same returnUrl, because the middleware faithfully rebuilds
 * the gateway-visible path in either case. The mis-route only becomes observable when the
 * catch-all is not running, which turns it into a 503 naming the wrong application.
 *
 * So these checks are only meaningful with the catch-all stopped. Refuse to report a pass
 * otherwise, rather than producing a green result on a broken gateway.
 */
const catchAllRunning = await (async () => {
  if (!catchAll) return false;
  try {
    await fetch(`http://localhost:${catchAll.port}/`, { redirect: 'manual' });
    return true;
  } catch {
    return false;
  }
})();

for (const app of apps) {
  const { name, basePath } = app;
  const index = await probe(`${gateway}${basePath}`);
  const attributable = basePath === '/' || !catchAllRunning || catchAll?.name === name;

  // 1. The application, not some other one, must answer its own prefix.
  if (index.unreachable && index.unreachable !== name) {
    record(
      name,
      'answers own prefix',
      'FAIL',
      `${basePath} was routed to "${index.unreachable}" — the prefix filter never matched, ` +
        `so the catch-all swallowed it`
    );
  } else if (index.unreachable === name) {
    record(name, 'answers own prefix', 'FAIL', `${name} is not running — start it and re-run`);
  } else if (!attributable) {
    record(
      name,
      'answers own prefix',
      'INCONCLUSIVE',
      `${basePath} -> ${index.status}, but "${catchAll.name}" is running and would answer ` +
        `identically if the filter were broken`
    );
  } else {
    record(name, 'answers own prefix', 'PASS', `${basePath} -> ${index.status}`);
  }

  // 2. The landing page must be protected when the application ships route protection.
  //    This is the check that catches a matcher missing its bare '/' entry.
  //    This one is attributable regardless of the catch-all: a 200 here means *nobody*
  //    protected the landing page, whichever application served it.
  if (app.protected && index.unreachable) {
    // The request never reached an application, so protection cannot be assessed.
    record(name, 'index protected', 'INCONCLUSIVE', `${basePath} -> ${index.status}, not served`);
  } else if (app.protected) {
    const ok = index.status >= 300 && index.status < 400;
    record(
      name,
      'index protected',
      ok ? 'PASS' : 'FAIL',
      ok
        ? `${basePath} -> ${index.status}`
        : `${basePath} -> ${index.status}, expected a redirect. The matcher in this ` +
          `application is missing its bare '/' entry, leaving the landing page public`
    );
  }

  // 3. Redirects must land on the gateway origin, never the application's internal port.
  if (index.location) {
    const ok = new URL(index.location, gateway).origin === new URL(gateway).origin;
    record(
      name,
      'redirect stays on gateway',
      ok ? 'PASS' : 'FAIL',
      ok ? index.location : `index redirected off-origin to ${index.location}`
    );
  }

  // 3b. The login page the redirect points at must actually render.
  //
  //     If the session entry points are not excluded from the shell's matcher, they match
  //     its catch-all and the middleware redirects /login to /login. Every check above
  //     still passes — a redirect is exactly what they want to see — while sign-in is an
  //     infinite loop and no session can ever be obtained.
  if (index.location) {
    const loginUrl = new URL(index.location, gateway);
    if (loginUrl.origin === new URL(gateway).origin) {
      const login = await probe(loginUrl.href);
      if (login.unreachable) {
        record(
          name,
          'login page reachable',
          'INCONCLUSIVE',
          `${loginUrl.pathname} -> ${login.status}, "${login.unreachable}" is not running`
        );
      } else if (login.status >= 300 && login.status < 400) {
        record(
          name,
          'login page reachable',
          'FAIL',
          `${loginUrl.pathname} -> ${login.status} to ${login.location}. The session entry ` +
            `points are not excluded from the matcher, so sign-in redirects to itself`
        );
      } else {
        record(name, 'login page reachable', 'PASS', `${loginUrl.pathname} -> ${login.status}`);
      }
    }
  }

  // 3c. A route handler must emit a Location on the gateway origin.
  //
  //     `new URL(path, request.nextUrl.origin)` is the documented middleware idiom, but in
  //     a route handler it produces the application's *internal* origin. Middleware is
  //     immune only because Next.js rewrites a same-origin absolute redirect to a relative
  //     Location, so the two look identical in source and differ at runtime.
  if (app.hasCallback) {
    const callback = await probe(`${gateway}/callback?returnUrl=%2F`);
    if (callback.unreachable) {
      record(name, 'callback stays on gateway', 'INCONCLUSIVE', `-> ${callback.status}`);
    } else if (callback.status >= 500) {
      record(
        name,
        'callback stays on gateway',
        'FAIL',
        `/callback -> ${callback.status}. A freshly bootstrapped repository usually hits ` +
          `this because AUTH_SESSION_SECRET is unset in .env`
      );
    } else if (!callback.location) {
      record(name, 'callback stays on gateway', 'INCONCLUSIVE', `-> ${callback.status}, no Location`);
    } else {
      const ok = new URL(callback.location, gateway).origin === new URL(gateway).origin;
      record(
        name,
        'callback stays on gateway',
        ok ? 'PASS' : 'FAIL',
        ok
          ? callback.location
          : `callback redirected to ${callback.location} — a route handler must emit a ` +
            `relative Location, not one built from request.nextUrl.origin`
      );
    }
  }

  // 4. A deep route must reach the application too, not only the index.
  const deep = await probe(`${gateway}${basePath === '/' ? '' : basePath}/__routing_probe`);
  if (deep.unreachable && deep.unreachable !== name) {
    record(name, 'deep route reaches app', 'FAIL', `routed to "${deep.unreachable}" instead`);
  } else if (!attributable) {
    record(name, 'deep route reaches app', 'INCONCLUSIVE', `-> ${deep.status}, catch-all running`);
  } else {
    record(name, 'deep route reaches app', 'PASS', `-> ${deep.status}`);
  }

  // 5. The prefix must not capture a longer sibling: /billing must not take /billings.
  //
  //    Attribution cannot be read off the redirect: the catch-all builds its returnUrl
  //    from its own '/' basePath, so a correct '/billings' redirect still contains the
  //    string '/billings'. Instead, ask both candidates directly on their own ports and
  //    see whose answer the gateway reproduced.
  if (basePath !== '/') {
    const siblingPath = `${basePath}s`;
    const viaGateway = await probe(`${gateway}${siblingPath}`);
    const direct = async (target) => {
      try {
        return await probe(`http://localhost:${target.port}${siblingPath}`);
      } catch {
        return null;
      }
    };
    const viaApp = await direct(app);
    const viaCatchAll = catchAll && catchAll.name !== name ? await direct(catchAll) : null;

    if (viaGateway.unreachable === name) {
      record(name, 'no prefix over-match', 'FAIL', `${siblingPath} was routed to "${name}"`);
    } else if (viaGateway.unreachable) {
      // The 503 names a different target, which settles attribution on its own.
      record(
        name,
        'no prefix over-match',
        'PASS',
        `${siblingPath} was routed to "${viaGateway.unreachable}", not this application`
      );
    } else if (!viaApp || (catchAll && !viaCatchAll)) {
      record(name, 'no prefix over-match', 'INCONCLUSIVE', `${siblingPath} -> not attributable`);
    } else {
      const looksLikeApp = viaGateway.status === viaApp.status;
      const looksLikeCatchAll = viaCatchAll !== null && viaGateway.status === viaCatchAll.status;
      const overMatched = looksLikeApp && !looksLikeCatchAll;
      record(
        name,
        'no prefix over-match',
        overMatched ? 'FAIL' : 'PASS',
        overMatched
          ? `${siblingPath} was served by "${name}" — the prefix filter is matching too much`
          : `${siblingPath} -> ${viaGateway.status} (not this application)`
      );
    }
  }
}

const pad = (text, width) => String(text).padEnd(width);
const width = Math.max(...results.map((r) => r.app.length), 3);

for (const { app, check, verdict, detail } of results) {
  console.info(`${pad(verdict, 12)}  ${pad(app, width)}  ${pad(check, 26)}  ${detail}`);
}

const failed = results.filter((r) => r.verdict === 'FAIL');
const inconclusive = results.filter((r) => r.verdict === 'INCONCLUSIVE');
const passed = results.length - failed.length - inconclusive.length;

console.info(
  `\n${passed} passed, ${failed.length} failed, ${inconclusive.length} inconclusive ` +
    `(${results.length} checks)`
);

if (failed.length > 0) process.exit(1);

if (inconclusive.length > 0) {
  console.error(
    '\nSome checks could not be attributed, so routing is NOT fully verified.\n\n' +
      'Prefix routing is only observable with the catch-all application stopped: while it\n' +
      'runs, it answers a mis-routed prefix exactly as the correct application would, and\n' +
      'a broken filter looks green. Run one application at a time:\n\n' +
      '  pnpm dev --filter=<app> --filter=gateway\n' +
      '  node verify-routing.mjs --app <app>\n'
  );
  process.exit(2);
}
