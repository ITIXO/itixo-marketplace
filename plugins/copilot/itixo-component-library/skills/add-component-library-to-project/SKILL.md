---
name: add-component-library-to-project
description: Add @itixo/component-library to a React project — the `@itixo:registry` scope mapping in the project `.npmrc`, installing the package with tailwindcss 4, importing the library stylesheet into the global CSS, and mounting ComponentLibraryProvider with its config options. Use when a project does not have @itixo/component-library yet, when setting up a new ITIXO frontend, when the project `.npmrc` lacks the @itixo scope mapping (404 from registry.npmjs.org), when library components render unstyled, or when ComponentLibraryProvider is missing or misconfigured. Trigger on indirect phrasing too — "add our component library here", "set up the design system in this app", "wire up the provider", "components have no styles".
---

# Add `@itixo/component-library` to a project

Mirrors *Installation* steps 1 and 3 and *Usage* step 1 on the **About project** page of the component library Storybook (`https://storybook.itixo-preview.com/root/storybook/?path=/docs/about-project--documentation`). When the two disagree, the Storybook page wins — update this skill to match.

This skill is about the **project**: one-time changes to the repository that every developer then shares. It does not set up anyone's machine — if npm fails with 401 or the developer has no token, use the `unlock-itixo-packages` skill. For using components after setup (component/prop reference, `DashboardLayout`, design tokens, styling rules), use the `itixo-component-library` skill.

## 1. Configure `.npmrc`

Add the scope mapping to the `.npmrc` in the project root:

```ini
registry=https://registry.npmjs.org
@itixo:registry=https://npm.pkg.github.com
```

The `@itixo:registry` line scopes only `@itixo/*` package names to GitHub Packages — everything else still resolves from `registry.npmjs.org`. These lines are registry configuration, not credentials, so they belong in version control; after adding them, tell the user the change should be committed. A `.npmrc` is also where npm keeps credentials (`_authToken`, `_password`, `_auth`), so check the project file holds only configuration before committing it. If it contains a token, move it to the user-level `~/.npmrc` and tell the user the token was exposed in the repository and should be revoked.

## 2. Install the library

This needs a working credential on the machine — if it fails with 401, use the `unlock-itixo-packages` skill.

```bash
npm install @itixo/component-library@latest tailwindcss@4.1.10
```

`tailwindcss ^4.1.10` is the only peer dependency. React 19, react-router 7, Radix primitives, and the library's other runtime dependencies come in with the package.

## 3. Import the stylesheet

In the app's global stylesheet:

```css
@import "@itixo/component-library/dist/index.css";
```

`@import "tailwindcss"` and Tailwind source scanning are already handled by the library — don't add them yourself, and don't create a `tailwind.config.*` file. Import the CSS exactly once, never per component.

| Framework | Global stylesheet |
|---|---|
| Next.js App Router | `app/globals.css` (imported by `app/layout.tsx`) |
| Next.js Pages Router | `styles/globals.css` (imported by `pages/_app.tsx`) |
| Vite + React | `src/index.css` (imported by `src/main.tsx`) |
| Anything else | Wherever the app's single global stylesheet lives |

## 4. Wrap the app with `ComponentLibraryProvider`

**Required.** Mount `ComponentLibraryProvider` once at the very top of the app — above everything that renders library components. It bundles the providers every library component expects: `I18nextProvider` (the library's own i18n instance), `TooltipProvider`, `ColorSchemeProvider` (light/dark/system theming and per-tenant primary color), and `Toaster` (so never mount `<Toaster />` by hand).

```tsx
import { ComponentLibraryProvider } from "@itixo/component-library";

export const App = ({ children }) => (
  <ComponentLibraryProvider
    config={{
      allowTheming: true,           // enables light/dark/system toggle
      allowCustomPrimaryColor: true, // enables per-tenant primary color
    }}
  >
    {children}
  </ComponentLibraryProvider>
);
```

| `config` prop | Type | Default | Description |
|---|---|---|---|
| `allowTheming` | `boolean` | `false` | Enables light/dark/system colour-scheme switching |
| `allowCustomPrimaryColor` | `boolean` | `false` | Enables per-tenant primary-colour overrides |
| `allowCustomTypography` | `boolean` | `false` | When `false` (strict), raw Tailwind font-size classes (`text-sm`, `text-lg`, …) throw in development. Use library tokens (`text-small-text`, `text-heading-1`, …) or `<Typography>` instead. Set `true` to disable the guard. |
| `tooltipDelayDuration` | `number` | — | Global tooltip open delay in ms |

`language` (`"en"` default, `"cs"`) and `toaster` config options are covered in the `itixo-component-library` skill's `references/dashboard-layout.md`. If the app has its own i18next translations, query the `itixo-component-library` MCP server's `get_integration_guide` (topic `i18n`) before wiring them — the app and the library must share one copy of `i18next` and `react-i18next`.

## 5. Ask about `DashboardLayout` (optional, recommended)

Once the provider is mounted, ask the user whether the app should use `DashboardLayout` as its app shell. Recommend it, but it is not required — library components work under `ComponentLibraryProvider` without it. Do not add it without an answer.

When asking, say briefly what it brings: the shared ITIXO navbar (logo, app name, breadcrumbs, agenda waffle menu, account dropdown, settings dialog), an optional sidebar, and a content area — so the app looks and behaves like the other ITIXO apps. If the app already has its own layout, point out that switching replaces it.

If the user says yes, collect what the layout needs before writing code: the current route, the signed-in user (`name`, `email`, `signOut`), the company logo and app name, the sidebar routes, and the framework's `Link` (and `Image`, if used) for `adapters`. Then mount it directly inside `ComponentLibraryProvider`:

```tsx
import { ComponentLibraryProvider, DashboardLayout } from "@itixo/component-library";
import Link from "next/link"; // or the router's Link in a non-Next.js app

export const App = ({ children }) => (
  <ComponentLibraryProvider config={{ allowTheming: true, allowCustomPrimaryColor: true }}>
    <DashboardLayout
      currentRoute={pathname}
      user={{ name: "Jan Novák", email: "jan.novak@company.com", signOut }}
      navbar={{ companyLogo: LOGO, appName: "Dashboard UI" }}
      navigation={{ sidebarRoutes: ROUTES }}
      adapters={{ Link }}
    >
      {children}
    </DashboardLayout>
  </ComponentLibraryProvider>
);
```

For the full prop set (breadcrumbs, agendas, stripe banner, settings, account switching, footer, slots), use the `DashboardLayout` section of the `itixo-component-library` skill and its `references/dashboard-layout.md`, and confirm props with the MCP server's `get_component_props` for `DashboardLayout`.

If the user says no, the setup is complete.
