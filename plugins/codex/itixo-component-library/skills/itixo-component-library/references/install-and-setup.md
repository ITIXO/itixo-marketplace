# Install & setup

## 1. Install the package

```bash
npm install @itixo/component-library@latest
```

The package is published to **GitHub Packages** under the `ITIXO` organization, not to the public npm registry. The consumer needs a project `.npmrc` mapping the scope:

```ini
registry=https://registry.npmjs.org
@itixo:registry=https://npm.pkg.github.com
```

plus a credential in the **user-level** `~/.npmrc` (never the committed project one) — a classic GitHub PAT with the `read:packages` scope, authorized for the `ITIXO` organization via *Configure SSO* if the token page offers that button:

```ini
//npm.pkg.github.com/:_authToken=<PAT_TOKEN>
```

Replace the whole placeholder `<PAT_TOKEN>` — **angle brackets included** — with the token itself. `npm login --scope=@itixo --auth-type=legacy --registry=https://npm.pkg.github.com` does the same thing interactively; it prompts only for **Username** (the GitHub username) and **Password** (the PAT), not for an email, and `--auth-type=legacy` is required because GitHub Packages does not support npm's default web login.

Failure modes: a **404** on `https://registry.npmjs.org/@itixo%2fcomponent-library` means the `@itixo:registry` scope mapping is missing; a **401** means the token is missing, still wrapped in angle brackets, lacks `read:packages`, or has not been SSO-authorized for the `ITIXO` organization. Never write the token into the project `.npmrc`.

Peer requirement: `tailwindcss ^4.1.10`. The library brings in React 19, react-router 7, all Radix primitives, recharts, react-hook-form, zod, sonner, react-hot-toast, lucide-react, react-icons, date-fns, motion, embla-carousel, vaul, cmdk, and i18next. You don't need to install any of those directly.

## 2. Import the stylesheet

In the app's global stylesheet:

```css
@import "@itixo/component-library/dist/index.css";
```

- The `@import` pulls in the compiled CSS (design tokens, theme classes, base styles, dark mode flips).
- The library's CSS already contains a `@source "./"` directive that tells **Tailwind v4** to scan the library's compiled output so the utility classes used inside it are emitted into the final CSS bundle. You don't need to add your own `@source` — it works across npm, pnpm, and Yarn.

### Where to put the stylesheet

| Framework | Location |
|---|---|
| Next.js App Router | `app/globals.css` (imported by `app/layout.tsx`) |
| Next.js Pages Router | `styles/globals.css` (imported by `pages/_app.tsx`) |
| Vite + React | `src/index.css` (imported by `src/main.tsx`) |
| Anything else | Wherever the app's single global stylesheet lives |

**Import the CSS exactly once, in the global stylesheet — never per component.**

## 3. Tailwind v4 — no config file

The library is built against Tailwind v4, whose config is CSS-native. You do **not** need a `tailwind.config.ts` / `tailwind.config.js` in the consumer app. The single `@import` line above is the entire integration.

If a `tailwind.config.*` already exists in the consumer (carried over from v3), it can stay, but ITIXO's tokens and the library's class groups come from CSS — don't try to re-declare them in JS config.

## 4. Verify

After install, drop this somewhere in the app:

```tsx
import { Button } from "@itixo/component-library";

export default function Smoke() {
  return <Button variant="secondary">it works</Button>;
}
```

If the button renders with ITIXO's purple primary, rounded corners, and proper spacing, the install is good. If it renders unstyled, the CSS import is missing.
