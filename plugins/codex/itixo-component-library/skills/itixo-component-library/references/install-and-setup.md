# Install & setup

## 1. Install the package

```bash
npm install @itixo/component-library@latest
```

The package is published to ITIXO's internal Azure Artifacts npm feed. If `npm install` fails with a 404 or auth error, the consumer's `.npmrc` is missing the feed registration. Get the `.npmrc` snippet from the component-library repo or from a teammate.

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
