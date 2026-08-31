#!/usr/bin/env node
/**
 * Resolves the exact versions for the catalog in `pnpm-workspace.yaml`.
 *
 * The catalog pins exact versions, and `pnpm-workspace.yaml` also sets a
 * `minimumReleaseAge` quarantine. Those two rules conflict: pinning today's `latest`
 * makes `pnpm install` fail with "within the minimumReleaseAge cutoff". This script
 * resolves each package to the highest semver version published before that cutoff.
 *
 * Sorting is by semver, never by publish date. Maintained release lines get backports,
 * so date ordering silently selects an older major: express 4.x over 5.x, @types/node
 * 22.x over 26.x, @types/react 18.x over 19.x.
 *
 * Usage:
 *   node resolve-versions.mjs                        core dependencies, "name version" lines
 *   node resolve-versions.mjs --with-i18n --with-logger --with-api-types
 *   node resolve-versions.mjs --yaml                 ready to paste as a catalog block
 *   node resolve-versions.mjs --json
 *   node resolve-versions.mjs --release-age-minutes 10080
 *
 * Exits 1 if any package has no stable release old enough to satisfy the cutoff.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const CORE = [
  '@biomejs/biome',
  '@tailwindcss/postcss',
  '@tanstack/react-query',
  '@testing-library/dom',
  '@testing-library/react',
  '@types/node',
  '@types/react',
  '@types/react-dom',
  '@vitejs/plugin-react',
  'axios',
  'express',
  'http-proxy-middleware',
  'jose',
  'jsdom',
  'next',
  'react',
  'react-dom',
  'tailwindcss',
  'turbo',
  'typescript',
  'vite-tsconfig-paths',
  'vitest'
];

const OPTIONAL = {
  '--with-i18n': ['i18next', 'react-i18next'],
  '--with-logger': ['winston', '@datalust/winston-seq'],
  '--with-api-types': ['openapi-typescript']
};

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};

const packages = [...CORE];
for (const [name, extra] of Object.entries(OPTIONAL)) {
  if (flag(name)) packages.push(...extra);
}
packages.sort();

// pnpm's cutoff is `now - minimumReleaseAge`; subtract an extra hour of margin so a
// release sitting exactly on the boundary cannot flip between resolve and install.
const releaseAgeMinutes = Number(value('--release-age-minutes', '10080'));
const cutoff = Date.now() - releaseAgeMinutes * 60 * 1000 - 60 * 60 * 1000;

const isStable = (version) => /^\d+\.\d+\.\d+$/.test(version);

const bySemverDesc = (a, b) => {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  return right[0] - left[0] || right[1] - left[1] || right[2] - left[2];
};

const resolveOne = async (name) => {
  const { stdout } = await run('npm', ['view', name, 'time', '--json'], {
    maxBuffer: 32 * 1024 * 1024
  });
  const times = JSON.parse(stdout);
  const eligible = Object.entries(times)
    .filter(([version]) => isStable(version))
    .filter(([, published]) => Date.parse(published) <= cutoff)
    .map(([version]) => version)
    .sort(bySemverDesc);
  return { name, version: eligible[0] ?? null };
};

/** Resolves with bounded concurrency: `npm view` is network-bound and rate-limited. */
const mapWithLimit = async (items, limit, fn) => {
  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
};

const resolved = await mapWithLimit(packages, 8, resolveOne);
const missing = resolved.filter((entry) => entry.version === null);

if (flag('--json')) {
  console.info(
    JSON.stringify(Object.fromEntries(resolved.map((e) => [e.name, e.version])), null, 2)
  );
} else if (flag('--yaml')) {
  console.info('catalog:');
  for (const { name, version } of resolved) {
    const key = /^[a-z][a-z0-9-]*$/.test(name) ? name : `"${name}"`;
    console.info(`  ${key}: "${version ?? 'UNRESOLVED'}"`);
  }
} else {
  for (const { name, version } of resolved) {
    console.info(`${name} ${version ?? 'UNRESOLVED'}`);
  }
}

if (missing.length > 0) {
  console.error(
    `\nNo stable release older than the cutoff for: ${missing.map((e) => e.name).join(', ')}`
  );
  process.exit(1);
}
