---
name: itixo-component-library
description: How to consume the @itixo/component-library npm package inside an external React app — install, Tailwind v4 wiring, DashboardLayout shell, design tokens, and the component/prop reference. Use whenever an ITIXO app installs, imports, themes, or upgrades @itixo/component-library, or whenever the user mentions ITIXO components, DashboardLayout, GenericTable, or design tokens. Trigger on indirect phrasing too — "add a button to match our other apps", "set up our shared layout", "what props does X take", "how do I theme this", "wire up the sidebar / breadcrumbs / waffle menu". When in doubt, trigger.
---

# `@itixo/component-library` — consumer usage guide

ITIXO's shared design system: React 19 + Tailwind v4 + shadcn/Radix, packaged as `@itixo/component-library` on the internal Azure Artifacts npm registry. It ships a `DashboardLayout` app shell and ~150 named exports (UI primitives, layout, hooks, types, utilities).

This skill is for agents working **inside a consuming app**, not inside the library repo itself.

## Before you write code: find the right component & its props

Don't guess component names or props from memory — the library has its own catalog and the shapes drift between versions. Sources, in order:

1. **The `itixo-component-library` MCP server — use this first.** The library ships its own MCP server (registered as `itixo-component-library`; see the project's `.mcp.json`). It exposes the catalog, props, examples, theme tokens, and changelog directly — query it instead of grepping `node_modules`. Tools:
   - `list_components` — list/filter components by category (`ui`, `form`, `layout`, `navigation`, `overlay`, `data`, `chart`, `utility`).
   - `search_component` — find a component by name/description/use ("loading", "date picker", "modal", …).
   - `get_component_props` — exact props, types, required flags, defaults, and the import statement.
   - `get_component_example` — copy-paste-ready TSX (optionally a named story `variant`).
   - `get_theme_tokens` — exact CSS token names by category (`color`/`spacing`/`radius`/`typography`/`shadow`).
   - `get_changelog` — structured release entries (optionally filtered by `version`).

   **Don't mindlessly grep or scan `node_modules/@itixo/component-library` for types/usage — ask the MCP server.**
2. **[references/components.md](references/components.md)** — offline quick reference: the full export catalog grouped by category (UI, forms, overlays, navigation, data, charts, utilities), with the notable props for each. Use when the MCP server isn't available.
3. **The installed package's own types** — `node_modules/@itixo/component-library/dist/types/index.d.ts`. The authoritative, version-exact fallback: every export, prop type, and JSDoc comment. When it disagrees with this skill, the `.d.ts` wins.

For design tokens (exact CSS variable names), use the MCP server's `get_theme_tokens`, see **[references/design-tokens.md](references/design-tokens.md)**, or search the installed stylesheet at `node_modules/@itixo/component-library/dist/index.css`.

## Install & setup

Two steps. Full details in [references/install-and-setup.md](references/install-and-setup.md).

```bash
npm install @itixo/component-library@latest
```

In the app's global stylesheet (`app/globals.css` for Next.js App Router, `src/index.css` for Vite, etc.):

```css
@import "@itixo/component-library/dist/index.css";
```

The library's CSS includes a `@source "./"` directive that tells Tailwind v4 to scan the library's compiled output so its utility classes are emitted. The library brings Tailwind with it — no `tailwind.config.*` file or manual `@source` is needed.

## Importing components

Single barrel. Always import from the package root, never from deep paths:

```tsx
import { Button, Dialog, DialogContent, DialogTrigger, cn } from "@itixo/component-library";
```

The CSS side-effect (`@itixo/component-library/dist/index.css`) belongs in the app's global stylesheet, **not** per-component.

## `DashboardLayout` — the recommended app shell

For any ITIXO app that needs a navbar + sidebar + content area with shared theming, account dropdown, agenda waffle menu, and breadcrumbs, drop in `<DashboardLayout>` and wire its props. Full prop walkthrough in [references/dashboard-layout.md](references/dashboard-layout.md).

```tsx
import { ComponentLibraryProvider, DashboardLayout, Badge, buildSiteMap } from "@itixo/component-library";
import Image from "next/image";
import Link from "next/link";

<ComponentLibraryProvider config={{ allowTheming: true }}>
  <DashboardLayout
    currentRoute={pathname}
    user={{
      name: "Prokop Dveře",
      email: "prokop@itixo.com",
      signOut: () => signOutFn(),
      badges: <Badge variant="purple">Admin</Badge>,
    }}
    navbar={{ companyLogo: COMPANY_LOGO_BASE64, appName: "Dashboard UI" }}
    navigation={{
      sidebarRoutes: ROUTES,
      siteMap: buildSiteMap(ROUTE_DEFINITIONS),
      agendas: AGENDAS,
    }}
    adapters={{ Image, Link }}  // inject the framework's Image/Link (Next.js, react-router, …)
  >
    {children}
  </DashboardLayout>
</ComponentLibraryProvider>
```

Two patterns worth knowing up front:

- **Framework injection.** `adapters.Image` and `adapters.Link` are slots — pass `next/image` and `next/link`'s `Link` (or React Router's `Link`, etc.). The library never imports a framework directly.
- **Breadcrumbs.** Pass `navigation={{ siteMap: buildSiteMap(ROUTE_DEFINITIONS) }}` for auto-derivation, or `navigation={{ breadcrumbs: [{ name, route? }, ...] }}` for explicit control.

## Styling discipline (the load-bearing rules)

Full guide in [references/design-system-guidelines.md](references/design-system-guidelines.md); layout spacing + a full page skeleton in [references/dashboard-layout.md](references/dashboard-layout.md). These are the rules that, when skipped, produce subtly-wrong-looking ITIXO apps. Do not skip them.

1. **Type scale, not Tailwind font sizes.** The library has its own scale — raw `text-sm` / `text-lg` / `text-xl` / `text-2xl` bypass it and drift visually.
   ```tsx
   // ✗ <p className="text-sm text-gray-500">…</p>   <h2 className="text-xl font-bold">…</h2>
   // ✓
   <Typography variant="heading-2" as="h2">Customers</Typography>
   <Typography variant="small-text">View and manage accounts.</Typography>
   <span className={cn(typographyVariants({ variant: "body-large" }))}>…</span>
   ```
   Use `<Typography>` for **all** text — headings included (set the element with `as="h1"`, `as="h2"`, …). `Typography` variants: `display-large`, `display`, `heading-1`, `heading-2`, `heading-3`, `body-large`, `base`, `small-text`, `smaller-text`, `smallest-text`, `label-text`. The matching utilities are `text-display-large` … `text-heading-1` … `text-body-large` … `text-smaller-text`. (`text-base` is the library's 1rem token and is fine; the other Tailwind `text-*` sizes are not.) **`Heading` is deprecated — don't use it; use `<Typography variant="heading-1" as="h1">` etc. instead.**

2. **Don't add outer page margins/padding.** `DashboardLayout` already wraps `children` in `py-5 sm:px-5` (no max-width). Re-padding the top node double-spaces it and looks asymmetrical.
   ```tsx
   // ✗ <div className="container mx-auto p-6"> … </div>
   // ✓ <div className="space-y-4"> … </div>   // space *between* cards only
   ```

3. **Cards are the default surface — don't put content on the raw background.** The layout background is `bg-background` (low-contrast gray/dark); text and controls placed directly on it look washed-out (gray-on-gray). Group page content into `<Card>` (which is `bg-surface`).
   ```tsx
   // ✗ <div className="space-y-4"><h2>Title</h2><Input … /></div>   // on bg-background
   // ✓
   <Card>
     <CardHeader><CardTitle>Title</CardTitle></CardHeader>
     <CardContent> … </CardContent>
   </Card>
   ```
   Always use `CardHeader` / `CardContent` / `CardFooter` as Card's direct children — never raw content directly inside `Card`.

4. **Form controls must sit on a surface.** `<Input>`, `<Select>`, `<Textarea>` have a **transparent** background by default — correct on `bg-surface` / inside a Card, unreadable on `bg-background`. Put every form inside a `<Card>` (or another `bg-surface` container).

5. **Merge classes with `cn()` from the library** — not raw `clsx`, not template strings.
   ```tsx
   import { cn } from "@itixo/component-library";
   <div className={cn("flex gap-2", isActive && "bg-surface-accent", className)} />
   ```
   The library's `cn()` is a `tailwind-merge` extension that understands library-specific class groups (`text-heading-1`, `bg-surface`, custom shadows/radii). Plain `tailwind-merge` will merge incorrectly.

6. **Use design tokens, never hex/raw values.** Find the exact CSS variable name in [references/design-tokens.md](references/design-tokens.md). Categories: `color`, `spacing`, `radius`, `typography`, `shadow`. Theming flips via CSS variables — hardcoded values break dark mode and the role-based color override.

7. **Typography hierarchy.** Heading variants must reflect the actual nesting level — page title = `heading-1` or `heading-2`, section/card title = `heading-2` or `heading-3`, body = `base`. Don't reuse `heading-1` for every title or pick variants by size alone. See the Hierarchy rules table in [references/design-system-guidelines.md](references/design-system-guidelines.md).

8. **Dialog & Popover buttons.** Cancel + Confirm pairs: right-aligned (`DialogFooter` / `flex justify-end gap-2`), Cancel → Confirm order (left to right), `variant="outline"` for Cancel, `variant="default"` for Confirm.

9. **Async button loading state.** Any button that fires an API call must preserve its width (`min-w-[...]`), render `<Spinner size="sm" />` while loading, and be `disabled={isLoading}`. `Spinner`'s `size` is `"sm" | "md" | "lg"` (16/24/32px) or a pixel number. (`width`/`height` still work but are **deprecated** — prefer `size`.)

10. **Destructive actions need `AlertDialog`.** Delete / Remove / Reset / Archive must confirm via `AlertDialog` before the mutation runs — never wire a destructive call directly to `onClick`.

## Staying current

The library ships frequent fixes and occasional breaking changes (e.g. 0.3.0 reworked breadcrumbs, 0.3.1 changed `RowId` typing on `GenericTable`). The installed version is the source of truth — check `node_modules/@itixo/component-library/package.json` for the version, the MCP server's `get_changelog` for what changed, and the bundled types (`dist/types/index.d.ts`) for the current API. Don't recite component APIs from training data — they're wrong by definition for any version newer than your knowledge cutoff.

## Common pitfalls

- **Tailwind v4 only.** No `tailwind.config.*` file; config is CSS-native via the imported stylesheet. Peer dep: `tailwindcss ^4.1.10`.
- **Don't re-implement primitives.** Scan [references/components.md](references/components.md) before reaching for headless-ui, react-aria, or a hand-rolled component. The library covers Button, Input, Select, Checkbox, Radio, Switch, Dialog, AlertDialog, Drawer, Sheet, Popover, Tooltip, DropdownMenu, Command, Tabs, Accordion, Calendar, GenericTable, Forms (`Form` + `FormField`), Toast (`Toaster` + `toast()`), and more.
- **Don't fork components into the consumer app.** If something's missing or broken, request it upstream in the component-library repo.
- **React 19 + react-router 7** are the library's expectations. App Router or Pages Router (Next.js), Vite + react-router, or any React 19 setup all work — the library doesn't care, as long as you inject the framework's `Link`/`Image` via the slot props.
- **GenericTable is fully server-driven.** Pagination, sorting, and filtering state are passed in externally — don't expect client-side defaults.
- **Don't wire destructive actions directly to `onClick`.** Every Delete / Remove / Reset must go through `AlertDialog` to confirm before the mutation fires.
- **Don't forget loading state on async buttons.** Preserve the button width, show `<Spinner>`, and set `disabled={isLoading}` — don't just disable without visual feedback.
- **`toast.*()` requires an object, not a string.** Unlike `react-hot-toast` or `sonner`, this library's `toast.success / error / warning / info` accept `ToastOptions`, not a plain string. Pass `{ title, description? }`:
  ```tsx
  // ✗ toast.success("Project updated");           // TS error
  // ✓ toast.success({ title: "Project updated", description: "Changes were saved." });
  ```

## Quick map of where things live in this skill

- [references/components.md](references/components.md) — full export catalog by category + notable props (the component/prop reference)
- [references/install-and-setup.md](references/install-and-setup.md) — install + Tailwind v4 + per-framework CSS placement
- [references/dashboard-layout.md](references/dashboard-layout.md) — full `DashboardLayout` prop walkthrough + breadcrumb modes + migration notes
- [references/design-tokens.md](references/design-tokens.md) — color / spacing / radius / shadow / typography tokens
- [references/design-system-guidelines.md](references/design-system-guidelines.md) — tokens, `cn()`, Typography, color scheme, forms, tables, do's and don'ts
