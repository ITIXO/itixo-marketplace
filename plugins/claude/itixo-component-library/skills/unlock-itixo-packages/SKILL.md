---
name: unlock-itixo-packages
description: Set up a developer machine so npm can download @itixo packages (such as @itixo/component-library) from GitHub Packages — classic personal access token, user-level `~/.npmrc` or `npm login`, and the project's `@itixo:registry` scope mapping. Use when a developer is new on a project, runs `npm install` / `pnpm install` for the first time, or the install fails on an @itixo package — 404 from registry.npmjs.org, 401 "authentication token not provided", "User cannot be authenticated with the token provided", or questions about `.npmrc`, PAT tokens, SSO authorization, or `npm login`. Trigger on indirect phrasing too — "I can't install the project", "npm can't find @itixo", "how do I get access to our packages".
---

# Access to `@itixo` packages on GitHub Packages

Mirrors the *Installation* steps 1–2 on the **About project** page of the component library Storybook (`https://storybook.itixo-preview.com/root/storybook/?path=/docs/about-project--documentation`). When the two disagree, the Storybook page wins — update this skill to match.

This skill is about the **developer's environment**: getting a machine to the point where the project's normal install command succeeds. It does not touch the app's code. For wiring the library into an app (stylesheet, `ComponentLibraryProvider`, components), use the `itixo-component-library` skill.

`@itixo/*` packages are published to **GitHub Packages** under the `ITIXO` organization, not to the public npm registry. npm needs two things before it can download them:

1. **A scope mapping** — tells npm that `@itixo/*` lives on `npm.pkg.github.com`. Belongs in the project `.npmrc`, in version control.
2. **A credential** — the developer's personal token for `npm.pkg.github.com`. Belongs in the user-level `~/.npmrc`, never in version control.

Either one can be missing. Check both before changing anything.

## Diagnose first

Run these from the project root. None of them print the token.

```bash
npm config get @itixo:registry
npm whoami --registry=https://npm.pkg.github.com
```

- `npm config get @itixo:registry` prints `https://npm.pkg.github.com` — the scope mapping is fine. Prints `undefined` — see [Scope mapping](#1-scope-mapping-project-npmrc).
- `npm whoami` prints a GitHub username — the credential works; the problem is elsewhere. Fails with 401 — see [Credential](#2-credential-user-level-npmrc).

Never `cat` the user's `~/.npmrc` or echo its contents — it holds their token. To check whether a token line exists at all, count matches without printing them: `grep -c "npm.pkg.github.com/:_authToken" ~/.npmrc`.

## 1. Scope mapping (project `.npmrc`)

The `.npmrc` in the project root should contain:

```ini
registry=https://registry.npmjs.org
@itixo:registry=https://npm.pkg.github.com
```

The `@itixo:registry` line scopes only `@itixo/*` package names to GitHub Packages — everything else still resolves from `registry.npmjs.org`. These lines are registry configuration, not credentials, so they belong in version control. If they are missing, add them and tell the user the change should be committed.

A `.npmrc` is also where npm keeps credentials (`_authToken`, `_password`, `_auth`), so check the project file holds only configuration before committing it; if an earlier setup left a token there, move it to `~/.npmrc` and tell the user the token was exposed in the repository and should be revoked.

## 2. Credential (user-level `~/.npmrc`)

### Create the token

The developer creates a **classic Personal Access Token** on GitHub: Settings → Developer settings → Personal access tokens → Tokens (classic).

- Scope: `read:packages`.
- GitHub Packages does not accept **fine-grained** tokens.
- If the token page shows a *Configure SSO* button for the `ITIXO` organization, authorize the token there too, or it is rejected.

The token is the developer's personal secret. Never generate, guess, or ask the user to paste it into the chat — give them the commands below and let them run them in their own terminal.

### Store the token

Either log in interactively:

```bash
npm login --scope=@itixo --registry=https://npm.pkg.github.com
```

npm prompts for two values — **Username** (the GitHub username) and **Password** (paste the PAT, not the GitHub password). It does not ask for an email. On success npm writes the token *and* an `@itixo:registry` line into the user-level `~/.npmrc`.

Or append the token to the **user-level** `~/.npmrc` directly (never the project one — that file is committed):

```bash
echo "//npm.pkg.github.com/:_authToken=<PAT_TOKEN>" >> ~/.npmrc
```

Replace the whole placeholder `<PAT_TOKEN>` — **angle brackets included** — so the finished line reads `//npm.pkg.github.com/:_authToken=ghp_xxxxxxxx…`. Leaving the brackets in produces a line npm accepts silently and then fails with a 401 on the next install.

Keep the token out of the project `.npmrc` and out of any Docker image layer. For Dockerfile and CI wiring, point the user to [Consuming the Packages](https://github.com/ITIXO/154.ICL/wiki/Consuming-the-Packages) in the library repository wiki.

## 3. Confirm

```bash
npm whoami --registry=https://npm.pkg.github.com
npm view @itixo/component-library version
```

A username and a version number mean access works. Then run the project's usual install command (`npm install`, `pnpm install`, …).

## Reading failures

| Symptom | Cause |
|---|---|
| **404** for `@itixo/...` against `registry.npmjs.org` | The `@itixo:registry` scope mapping is missing |
| **401** `authentication token not provided` | No token for `npm.pkg.github.com` in `~/.npmrc` |
| **401** `User cannot be authenticated with the token provided` | Malformed token — angle brackets left in the placeholder are the usual cause |
| **401 / 403** with a token that looks right | Token is fine-grained instead of classic, lacks `read:packages`, is expired, or is not SSO-authorized for `ITIXO` |
