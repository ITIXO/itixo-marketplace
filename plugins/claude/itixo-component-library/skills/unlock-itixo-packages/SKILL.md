---
name: unlock-itixo-packages
description: Set up a developer machine so npm can download @itixo packages (such as @itixo/component-library) from GitHub Packages — classic personal access token with read:packages, SSO authorization, and storing it in the user-level `~/.npmrc`. Use when a developer is new on a project, runs `npm install` / `pnpm install` for the first time, or the install fails on an @itixo package — 401 "authentication token not provided", "User cannot be authenticated with the token provided", 404 from registry.npmjs.org, or questions about PAT tokens, `~/.npmrc`, SSO authorization, or a hanging `npm login`. Trigger on indirect phrasing too — "I can't install the project", "npm can't find @itixo", "how do I get access to our packages".
---

# Unlock `@itixo` packages on this machine

This skill is about the **developer's machine**: giving npm a credential so the project's normal install command can download `@itixo/*` packages from **GitHub Packages** (`ITIXO` organization). It does not change the project. The project side — the `@itixo:registry` scope mapping in the project `.npmrc`, installing the library, the stylesheet, and `ComponentLibraryProvider` — belongs to the `add-component-library-to-project` skill.

## Diagnose first

Run these from the project root. None of them print the token.

```bash
npm config get @itixo:registry
npm whoami --registry=https://npm.pkg.github.com
```

- `npm config get @itixo:registry` prints `undefined` — npm does not know where `@itixo/*` lives. The project is missing its scope mapping; use the `add-component-library-to-project` skill for that, then come back.
- `npm whoami` prints a GitHub username — the credential works; the problem is elsewhere. Fails with 401 — continue below.

Never `cat` the user's `~/.npmrc` or echo its contents — it holds their token. To check whether a token line exists at all, count matches without printing them: `grep -c "npm.pkg.github.com/:_authToken" ~/.npmrc`.

## Recommended: the setup script

This skill ships the same setup script in two versions — `scripts/unlock-itixo-packages.sh` (bash, macOS/Linux; needs `curl`) and `scripts/unlock-itixo-packages.ps1` (PowerShell, Windows; Windows PowerShell 5.1 or PowerShell 7+). It walks the developer through both steps below and handles the parts people get wrong:

- opens the classic-token page with `read:packages` pre-selected,
- **warns to authorize the token for `ITIXO` via *Configure SSO*** before asking for it,
- reads the token from a hidden prompt, rejects fine-grained tokens and pasted angle brackets,
- checks the token with GitHub before saving it: missing `read:packages`, missing SSO authorization (it prints GitHub's authorization link and re-checks after the developer confirms), and access to `@itixo/component-library`,
- replaces any old `npm.pkg.github.com` token line in the user-level npm config (`~/.npmrc`, or `NPM_CONFIG_USERCONFIG`) and keeps everything else.

The script needs an interactive terminal and the developer's own token, so do not run it yourself. Give the user the absolute path of the matching script inside this skill's directory and tell them to run it in their own terminal:

```bash
# macOS / Linux
bash <skill-directory>/scripts/unlock-itixo-packages.sh
```

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File <skill-directory>\scripts\unlock-itixo-packages.ps1
```

`-ExecutionPolicy Bypass` applies only to this one run, so the script works even where the machine policy blocks unsigned scripts.

When it finishes, continue with [3. Confirm](#3-confirm). The manual steps below are the fallback when neither script can run.

## 1. Create the token

The developer creates a **classic Personal Access Token** on GitHub: Settings → Developer settings → Personal access tokens → Tokens (classic).

- Scope: `read:packages`.
- GitHub Packages does not accept **fine-grained** tokens.
- **Authorize the token for SSO.** In the token list, click *Configure SSO* next to the token and choose *Authorize* for the `ITIXO` organization. Always tell the user about this step — without it GitHub rejects the token even though it looks correct.

The token is the developer's personal secret. Never generate, guess, or ask the user to paste it into the chat — give them the script or the commands below and let them run them in their own terminal.

## 2. Store the token

Do not suggest `npm login --scope=@itixo --registry=https://npm.pkg.github.com` — it hangs indefinitely against GitHub Packages and never finishes. If the user is stuck in it, tell them to cancel with Ctrl+C and store the token as below.

Append the token to the **user-level** `~/.npmrc` (never the project one — that file is committed):

```bash
# macOS / Linux
echo "//npm.pkg.github.com/:_authToken=<PAT_TOKEN>" >> ~/.npmrc
```

```powershell
# Windows — don't use `echo >>` here: Windows PowerShell writes UTF-16, which npm cannot read
npm config set --location=user "//npm.pkg.github.com/:_authToken" "<PAT_TOKEN>"
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
| **404** for `@itixo/...` against `registry.npmjs.org` | The project's `@itixo:registry` scope mapping is missing — see `add-component-library-to-project` |
| **401** `authentication token not provided` | No token for `npm.pkg.github.com` in `~/.npmrc` |
| **401** `User cannot be authenticated with the token provided` | Malformed token — angle brackets left in the placeholder are the usual cause |
| **401 / 403** with a token that looks right | Token is fine-grained instead of classic, lacks `read:packages`, is expired, or is not SSO-authorized for `ITIXO` |
