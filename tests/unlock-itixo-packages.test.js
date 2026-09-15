"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const { PROVIDERS } = require("../scripts/providers.js");

const SCRIPT_REL = "itixo-component-library/skills/unlock-itixo-packages/scripts/unlock-itixo-packages.sh";
const providerNames = Array.isArray(PROVIDERS) ? PROVIDERS : Object.keys(PROVIDERS);
const scripts = providerNames
  .map((provider) => path.join(ROOT, "plugins", provider, SCRIPT_REL))
  .filter((file) => fs.existsSync(file));

const VALID = "ghp_validtoken0000000000000000000000000";
const NO_SCOPE = "ghp_noscope00000000000000000000000000";
const NO_SSO = "ghp_nosso000000000000000000000000000000";
const SSO_URL = "https://github.com/orgs/ITIXO/sso?authorization_request=abc123";

// Fake curl: reads the Authorization header from the `-K -` config on stdin,
// picks a canned response by token and URL, and prints only headers.
const FAKE_CURL = `#!/usr/bin/env bash
config="$(cat)"
token="$(printf '%s' "$config" | sed -n 's/.*Bearer \\([^"]*\\)".*/\\1/p')"
for arg in "$@"; do url="$arg"; done
printf '%s\\n' "$*" >> "$FAKE_LOG"
case "$*" in *ghp_*) printf 'TOKEN_IN_ARGS\\n' >> "$FAKE_LOG" ;; esac
api_calls_file="$FAKE_STATE/api_calls"
case "$url" in
  */orgs/ITIXO/packages*)
    count=$(( $(cat "$api_calls_file" 2>/dev/null || echo 0) + 1 ))
    echo "$count" > "$api_calls_file"
    case "$token" in
      ${VALID}) printf 'HTTP/2 200\\r\\nx-oauth-scopes: read:packages, repo\\r\\n\\r\\n' ;;
      ${NO_SCOPE}) printf 'HTTP/2 403\\r\\nx-oauth-scopes: repo, gist\\r\\n\\r\\n' ;;
      ${NO_SSO})
        if [ "$count" -eq 1 ]; then
          printf 'HTTP/2 403\\r\\nx-github-sso: required; url=${SSO_URL}\\r\\nx-oauth-scopes: read:packages\\r\\n\\r\\n'
        else
          printf 'HTTP/2 200\\r\\nx-oauth-scopes: read:packages\\r\\n\\r\\n'
        fi ;;
      *) printf 'HTTP/2 401\\r\\n\\r\\n' ;;
    esac ;;
  */@itixo%2fcomponent-library)
    case "$token" in
      ${VALID}|${NO_SSO}) printf 'HTTP/2 200\\r\\n\\r\\n' ;;
      *) printf 'HTTP/2 403\\r\\n\\r\\n' ;;
    esac ;;
  *) printf 'HTTP/2 404\\r\\n\\r\\n' ;;
esac
`;

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unlock-itixo-"));
  const bin = path.join(dir, "bin");
  const state = path.join(dir, "state");
  fs.mkdirSync(bin);
  fs.mkdirSync(state);
  fs.writeFileSync(path.join(bin, "curl"), FAKE_CURL, { mode: 0o755 });
  const userconfig = path.join(dir, "home", ".npmrc");
  return { dir, bin, state, userconfig, log: path.join(dir, "curl.log") };
}

function run(script, env, input) {
  return spawnSync("bash", [script, "--no-browser"], {
    input,
    encoding: "utf8",
    env: {
      PATH: `${env.bin}:/usr/bin:/bin`,
      HOME: path.join(env.dir, "home"),
      TMPDIR: env.dir,
      NPM_CONFIG_USERCONFIG: env.userconfig,
      FAKE_STATE: env.state,
      FAKE_LOG: env.log,
    },
  });
}

test("unlock script exists for every provider copy of the plugin", () => {
  assert.equal(scripts.length, 3);
  const [first, ...rest] = scripts.map((file) => fs.readFileSync(file, "utf8"));
  for (const content of rest) assert.equal(content, first);
  for (const file of scripts) {
    assert.ok(fs.statSync(file).mode & 0o111, `${file} must be executable`);
  }
});

for (const script of scripts) {
  const provider = path.relative(path.join(ROOT, "plugins"), script).split(path.sep)[0];

  test(`${provider}: warns about SSO authorization before asking for the token`, () => {
    const env = setup();
    const result = run(script, env, `${VALID}\n`);
    assert.equal(result.status, 0, result.stderr);
    const ssoIndex = result.stdout.indexOf("Configure SSO");
    const promptIndex = result.stdout.indexOf("Paste the token");
    assert.ok(ssoIndex >= 0, "output must mention Configure SSO");
    assert.ok(ssoIndex < promptIndex, "SSO warning must come before the token prompt");
  });

  test(`${provider}: saves a verified token, keeps other lines, replaces the old token`, () => {
    const env = setup();
    fs.mkdirSync(path.dirname(env.userconfig), { recursive: true });
    fs.writeFileSync(
      env.userconfig,
      "@itixo:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=ghp_old\nsave-exact=true\n",
    );
    const result = run(script, env, `${VALID}\n`);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      fs.readFileSync(env.userconfig, "utf8"),
      `@itixo:registry=https://npm.pkg.github.com\nsave-exact=true\n//npm.pkg.github.com/:_authToken=${VALID}\n`,
    );
    assert.equal(fs.statSync(env.userconfig).mode & 0o777, 0o600);
    assert.ok(!result.stdout.includes(VALID), "token must not be printed");
    assert.ok(!fs.readFileSync(env.log, "utf8").includes("TOKEN_IN_ARGS"), "token must not be passed as an argument");
  });

  test(`${provider}: rejects fine-grained and bracketed tokens before calling GitHub`, () => {
    const env = setup();
    const result = run(script, env, `github_pat_abc\n<ghp_abc>\n${VALID}\n`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /fine-grained token/);
    assert.match(result.stdout, /angle brackets/);
    assert.equal(fs.readFileSync(path.join(env.state, "api_calls"), "utf8").trim(), "1");
  });

  test(`${provider}: points to the SSO authorization link and re-checks the same token`, () => {
    const env = setup();
    const result = run(script, env, `${NO_SSO}\n\n`);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(SSO_URL), "output must include the SSO authorization URL");
    assert.match(fs.readFileSync(env.userconfig, "utf8"), new RegExp(`_authToken=${NO_SSO}`));
  });

  test(`${provider}: does not write a token that lacks read:packages`, () => {
    const env = setup();
    const result = run(script, env, `${NO_SCOPE}\n`);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /missing the read:packages scope/);
    assert.ok(!fs.existsSync(env.userconfig), "npmrc must not be created");
  });

  test(`${provider}: ignores endpoint overrides from the environment`, () => {
    const env = setup();
    const result = spawnSync("bash", [script, "--no-browser"], {
      input: `${VALID}\n`,
      encoding: "utf8",
      env: {
        PATH: `${env.bin}:/usr/bin:/bin`,
        HOME: path.join(env.dir, "home"),
        TMPDIR: env.dir,
        NPM_CONFIG_USERCONFIG: env.userconfig,
        FAKE_STATE: env.state,
        FAKE_LOG: env.log,
        UNLOCK_ITIXO_GITHUB_API: "https://attacker.example",
        UNLOCK_ITIXO_REGISTRY_URL: "https://attacker.example",
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const log = fs.readFileSync(env.log, "utf8");
    assert.ok(!log.includes("attacker.example"), "token must only be sent to GitHub");
    assert.match(log, /https:\/\/api\.github\.com\/orgs\/ITIXO\/packages/);
    assert.match(log, /https:\/\/npm\.pkg\.github\.com\/@itixo%2fcomponent-library/);
  });

  test(`${provider}: puts the token on its own line when npmrc lacks a trailing newline`, () => {
    const env = setup();
    fs.mkdirSync(path.dirname(env.userconfig), { recursive: true });
    fs.writeFileSync(env.userconfig, "save-exact=true");
    const result = run(script, env, `${VALID}\n`);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(env.userconfig, "utf8"), `save-exact=true\n//npm.pkg.github.com/:_authToken=${VALID}\n`);
  });

  test(`${provider}: keeps a symlinked npmrc as a symlink`, () => {
    const env = setup();
    const target = path.join(env.dir, "dotfiles-npmrc");
    fs.writeFileSync(target, "save-exact=true\n");
    fs.mkdirSync(path.dirname(env.userconfig), { recursive: true });
    fs.symlinkSync(target, env.userconfig);
    const result = run(script, env, `${VALID}\n`);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.lstatSync(env.userconfig).isSymbolicLink());
    assert.match(fs.readFileSync(target, "utf8"), new RegExp(`_authToken=${VALID}`));
  });
}

// --- PowerShell version -----------------------------------------------------

const { spawn } = require("node:child_process");
const http = require("node:http");

const PS_SCRIPT_REL = "itixo-component-library/skills/unlock-itixo-packages/scripts/unlock-itixo-packages.ps1";
const psScripts = providerNames
  .map((provider) => path.join(ROOT, "plugins", provider, PS_SCRIPT_REL))
  .filter((file) => fs.existsSync(file));

function findPwsh() {
  for (const candidate of ["pwsh", "powershell"]) {
    const probe = spawnSync(candidate, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], { encoding: "utf8" });
    if (probe.status === 0) return candidate;
  }
  return null;
}
const pwsh = findPwsh();

// Local stand-in for api.github.com and npm.pkg.github.com, keyed by token.
function startFakeGitHub() {
  const state = { apiCalls: 0 };
  const server = http.createServer((req, res) => {
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    if (req.url.startsWith("/api/orgs/ITIXO/packages")) {
      state.apiCalls += 1;
      if (token === VALID) {
        res.writeHead(200, { "X-OAuth-Scopes": "read:packages, repo" });
      } else if (token === NO_SCOPE) {
        res.writeHead(403, { "X-OAuth-Scopes": "repo, gist" });
      } else if (token === NO_SSO && state.apiCalls === 1) {
        res.writeHead(403, { "X-GitHub-SSO": `required; url=${SSO_URL}`, "X-OAuth-Scopes": "read:packages" });
      } else if (token === NO_SSO) {
        res.writeHead(200, { "X-OAuth-Scopes": "read:packages" });
      } else {
        res.writeHead(401);
      }
    } else if (req.url === "/registry/@itixo%2fcomponent-library") {
      res.writeHead(token === VALID || token === NO_SSO ? 200 : 403);
    } else {
      res.writeHead(404);
    }
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({ state, base, close: () => new Promise((done) => server.close(done)) });
    });
  });
}

function runPs(script, env, fake, input) {
  return new Promise((resolve) => {
    const child = spawn(pwsh, ["-NoProfile", "-NonInteractive", "-File", script, "-NoBrowser"], {
      env: {
        ...process.env,
        HOME: path.join(env.dir, "home"),
        NPM_CONFIG_USERCONFIG: env.userconfig,
        UNLOCK_ITIXO_GITHUB_API: `${fake.base}/api`,
        UNLOCK_ITIXO_REGISTRY_URL: `${fake.base}/registry`,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(input);
  });
}

test("PowerShell unlock script exists and is identical for every provider copy", () => {
  assert.equal(psScripts.length, 3);
  const [first, ...rest] = psScripts.map((file) => fs.readFileSync(file, "utf8"));
  for (const content of rest) assert.equal(content, first);
});

for (const script of psScripts) {
  const provider = path.relative(path.join(ROOT, "plugins"), script).split(path.sep)[0];
  const skip = pwsh ? false : "PowerShell (pwsh) is not installed";

  test(`${provider} ps1: warns about SSO, saves a verified token, keeps other lines`, { skip }, async () => {
    const env = setup();
    const fake = await startFakeGitHub();
    try {
      fs.mkdirSync(path.dirname(env.userconfig), { recursive: true });
      fs.writeFileSync(
        env.userconfig,
        "@itixo:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=ghp_old\nsave-exact=true\n",
      );
      const result = await runPs(script, env, fake, `${VALID}\n`);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const ssoIndex = result.stdout.indexOf("Configure SSO");
      assert.ok(ssoIndex >= 0 && ssoIndex < result.stdout.indexOf("Paste the token"));
      assert.equal(
        fs.readFileSync(env.userconfig, "utf8"),
        `@itixo:registry=https://npm.pkg.github.com\nsave-exact=true\n//npm.pkg.github.com/:_authToken=${VALID}\n`,
      );
      assert.ok(!result.stdout.includes(VALID), "token must not be printed");
    } finally {
      await fake.close();
    }
  });

  test(`${provider} ps1: rejects fine-grained and bracketed tokens before calling GitHub`, { skip }, async () => {
    const env = setup();
    const fake = await startFakeGitHub();
    try {
      const result = await runPs(script, env, fake, `github_pat_abc\n<ghp_abc>\n${VALID}\n`);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /fine-grained token/);
      assert.match(result.stdout, /angle brackets/);
      assert.equal(fake.state.apiCalls, 1);
    } finally {
      await fake.close();
    }
  });

  test(`${provider} ps1: points to the SSO authorization link and re-checks the same token`, { skip }, async () => {
    const env = setup();
    const fake = await startFakeGitHub();
    try {
      const result = await runPs(script, env, fake, `${NO_SSO}\n\n`);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.ok(result.stdout.includes(SSO_URL));
      assert.match(fs.readFileSync(env.userconfig, "utf8"), new RegExp(`_authToken=${NO_SSO}`));
    } finally {
      await fake.close();
    }
  });

  test(`${provider} ps1: does not write a token that lacks read:packages`, { skip }, async () => {
    const env = setup();
    const fake = await startFakeGitHub();
    try {
      const result = await runPs(script, env, fake, `${NO_SCOPE}\n`);
      assert.notEqual(result.status, 0);
      assert.match(result.stdout, /missing the read:packages scope/);
      assert.ok(!fs.existsSync(env.userconfig), "npmrc must not be created");
    } finally {
      await fake.close();
    }
  });

  test(`${provider} ps1: refuses endpoint overrides that are not loopback`, { skip }, async () => {
    const env = setup();
    const fake = await startFakeGitHub();
    try {
      const result = await runPs(script, env, { base: "https://attacker.example" }, `${VALID}\n`);
      assert.notEqual(result.status, 0);
      assert.match(result.stdout + result.stderr, /only for tests and must point to localhost/);
      assert.ok(!fs.existsSync(env.userconfig), "npmrc must not be created");
    } finally {
      await fake.close();
    }
  });

  test(`${provider} ps1: creates a new npmrc readable only by the owner`, { skip: skip || (process.platform === "win32" && "POSIX permissions only") }, async () => {
    const env = setup();
    const fake = await startFakeGitHub();
    try {
      const result = await runPs(script, env, fake, `${VALID}\n`);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(fs.statSync(env.userconfig).mode & 0o777, 0o600);
    } finally {
      await fake.close();
    }
  });

  test(`${provider} ps1: puts the token on its own line when npmrc lacks a trailing newline`, { skip }, async () => {
    const env = setup();
    const fake = await startFakeGitHub();
    try {
      fs.mkdirSync(path.dirname(env.userconfig), { recursive: true });
      fs.writeFileSync(env.userconfig, "save-exact=true");
      const result = await runPs(script, env, fake, `${VALID}\n`);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(fs.readFileSync(env.userconfig, "utf8"), `save-exact=true\n//npm.pkg.github.com/:_authToken=${VALID}\n`);
    } finally {
      await fake.close();
    }
  });

  test(`${provider} ps1: keeps a symlinked npmrc as a symlink`, { skip }, async () => {
    const env = setup();
    const fake = await startFakeGitHub();
    try {
      const target = path.join(env.dir, "dotfiles-npmrc");
      fs.writeFileSync(target, "save-exact=true\n");
      fs.mkdirSync(path.dirname(env.userconfig), { recursive: true });
      fs.symlinkSync(target, env.userconfig);
      const result = await runPs(script, env, fake, `${VALID}\n`);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.ok(fs.lstatSync(env.userconfig).isSymbolicLink());
      assert.match(fs.readFileSync(target, "utf8"), new RegExp(`_authToken=${VALID}`));
    } finally {
      await fake.close();
    }
  });
}
