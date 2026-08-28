# `DashboardLayout` — the ITIXO app shell

> **Breaking in 1.0 — `DashboardLayout` with grouped props, a provider `config`, and strict typography.**
> - `AuthenticatedLayout` was a deprecated alias of `DashboardLayout`; it has been **removed**. Use `DashboardLayout`.
> - **Props are grouped** into nested objects (no longer a flat list): `user`, `navbar`, `navigation`, `stripe`, `roleView`, `accountSwitching`, `settings`, `adapters`; `currentRoute`, `children`, `slots` stay top-level. Map: `userName`→`user.name`, `companyLogo`/`appName`/`NavbarActions`→`navbar.*` (`actions`), `sidebarRoutes`/`siteMap`/`agendas`/`homeRoute`→`navigation.*`, `stripeMessage`→`stripe.message`, `allowRoleViewSwitch`→`roleView.allow`, `allowSwitchingAccounts`/`accounts`/`selectedAccount`→`accountSwitching.*` (`allow`/`accounts`/`selected`/`onSelect`), `allowSettingsDialog`/`settingsTabs`/`settingsContentClassName`→`settings.*` (`allow`/`tabs`/`contentClassName`), `LinkComponent`/`ImageComponent`→`adapters.Link`/`adapters.Image`.
> - Mount **`ComponentLibraryProvider`** once at your app root with a single **`config`** prop. It bundles `TooltipProvider`, the library i18n provider, `ColorSchemeProvider`, and the `Toaster` (no manual `<Toaster />`). **Theming moved here:** `config={{ tooltipDelayDuration?, allowTheming?, allowCustomPrimaryColor?, allowCustomTypography? }}`.
> - **`config.allowCustomTypography`** defaults to **`false` (strict)**: in development, a raw Tailwind font-size (`text-sm`, `text-lg`, …) in your code or in a `className` passed to a library component **throws** — use `<Typography>` / `typographyVariants()` (the library type scale: `text-heading-1`, `text-base`, `text-small-text`, …). Set `true` to opt out.
> - **`slots`** swaps any region, defaults for the rest: `slots.stripe`, `slots.sidebar`, `slots.navbar` (full replacement `slots={{ navbar: <MyNavbar/> }}` or per sector `slots={{ navbar: { left, center, right } }}`), `slots.footer` (full replacement — bypasses `footer.variant`/`navigationSections`/etc.; `footer.position` still controls sticky vs. scroll). Exported: `DashboardLayoutSlots`, `NavbarSectors`, `NavbarSectorLeft`, `NavbarSectorRight`.
>
> ```tsx
> import { ComponentLibraryProvider, DashboardLayout } from "@itixo/component-library";
>
> <ComponentLibraryProvider config={{ allowTheming: true, allowCustomPrimaryColor: true }}>
>   <DashboardLayout
>     currentRoute={pathname}
>     user={{ name: "Prokop Dveře" }}
>     adapters={{ Link }}
>     navigation={{ sidebarRoutes: ROUTES }}
>     slots={{ navbar: { center: <MyBreadcrumb /> } }}
>   >
>     {children}
>   </DashboardLayout>
> </ComponentLibraryProvider>
> ```

`DashboardLayout` (formerly `AuthenticatedLayout`) is the top-level layout component every authenticated ITIXO app uses. It composes:

- a **Navbar** (company logo, app name, breadcrumbs, agenda waffle menu, settings dialog, account dropdown, optional notification slot, optional stripe banner)
- an optional **Sidebar** built from `sidebarRoutes`
- the **content area** (your `children`)

The component is "framework-agnostic": it takes `adapters.Link` and `adapters.Image` so it can run inside Next.js (App or Pages router), Vite + react-router, Remix, or anywhere else.

> **Source of truth.** The prop list below is mirrored from the bundled types; the props churn between versions, so confirm against the installed package. Prefer the `itixo-component-library` **MCP server** (`get_component_props` for `DashboardLayout`) over grepping `node_modules`; the bundled type (`DashboardLayoutProps` in `node_modules/@itixo/component-library/dist/types/index.d.ts`) is the offline fallback. **As of 1.0 the props are grouped** (see the callout above) — older flat names in any example map via that table.

## Minimal example (Next.js)

```tsx
import { ComponentLibraryProvider, DashboardLayout, Badge, buildSiteMap } from "@itixo/component-library";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/router";

import { ROUTES, ROUTE_DEFINITIONS, AGENDAS, COMPANY_LOGO_BASE64 } from "./constants";

// Mount ComponentLibraryProvider once at the app root.
export const Providers = ({ children }: { children: React.ReactNode }) => (
  <ComponentLibraryProvider config={{ allowTheming: true, allowCustomPrimaryColor: true }}>
    {children}
  </ComponentLibraryProvider>
);

export const AppShell = ({ children }: { children: React.ReactNode }) => {
  const { pathname } = useRouter();

  return (
    <DashboardLayout
      currentRoute={pathname}
      user={{
        name: "Prokop Dveře",
        email: "prokop@itixo.com",
        signOut: () => fetch("/api/logout", { method: "POST" }),
        badges: (
          <>
            <Badge variant="purple">Admin</Badge>
            <Badge variant="orange">Moderator</Badge>
          </>
        ),
      }}
      navbar={{ companyLogo: COMPANY_LOGO_BASE64, appName: "Dashboard UI" }}
      navigation={{
        sidebarRoutes: ROUTES,
        siteMap: buildSiteMap(ROUTE_DEFINITIONS),
        agendas: AGENDAS,
      }}
      adapters={{ Link, Image }}
    >
      {children}
    </DashboardLayout>
  );
};
```

## Vite + React Router example

Same component, no framework adapter needed — pass react-router's `Link` via `adapters.Link` (the library hands it `to`),
use `useLocation().pathname` for `currentRoute`, and omit `adapters.Image` (the logo still renders).

```tsx
import { DashboardLayout, Badge, buildSiteMap } from "@itixo/component-library";
import { Link, useLocation } from "react-router";

import { ROUTES, ROUTE_DEFINITIONS, AGENDAS, COMPANY_LOGO_BASE64 } from "./constants";

// (wrap your app root in <ComponentLibraryProvider> once — see the Next.js example)
export const AppShell = ({ children }: { children: React.ReactNode }) => {
  const { pathname } = useLocation();

  return (
    <DashboardLayout
      currentRoute={pathname}
      user={{
        name: "Prokop Dveře",
        email: "prokop@itixo.com",
        signOut: () => fetch("/api/logout", { method: "POST" }),
        badges: <Badge variant="purple">Admin</Badge>,
      }}
      navbar={{ companyLogo: COMPANY_LOGO_BASE64, appName: "Dashboard UI" }}
      navigation={{
        sidebarRoutes: ROUTES,
        siteMap: buildSiteMap(ROUTE_DEFINITIONS),
        agendas: AGENDAS,
      }}
      adapters={{ Link }} // react-router Link — receives `to`; no Image → logo falls back to <img>
    >
      {children}
    </DashboardLayout>
  );
};
```

## Page content: spacing & layout contract

`DashboardLayout` already wraps your `children` in a scroll container padded with **`px-0 py-5 sm:px-5`** (and no max-width). This has direct consequences for what you render inside:

- **Don't re-pad the outer node.** No `container mx-auto`, no `p-6`/`m-6`/`px-8` on the top-level page element — it stacks on top of the layout's padding and produces asymmetrical gaps. Add only *vertical rhythm between* blocks (`space-y-4` / `space-y-6`).
- **Group content into `<Card>`s.** The content area sits on `bg-background`; raw text and form controls on it look washed-out. Each logical section is a `Card` (which is `bg-surface`). See "Surfaces & contrast" in [design-system-guidelines.md](design-system-guidelines.md).
- **Headings/text via `<Typography>`** (`as="h1"`, `as="h2"`, … for semantics), not raw tags or Tailwind font sizes. (`Heading` is deprecated.)

### Correct page skeleton

This one example exercises all four rules — no outer margin, cards as surfaces, the type scale, and a form on a surface:

```tsx
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
  Typography,
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
  Input, Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
  Button,
} from "@itixo/component-library";

export const SettingsPage = () => (
  // no container / mx-auto / p-* here — the layout already pads the content area.
  <div className="space-y-6">
    <div className="space-y-1">
      <Typography variant="heading-1" as="h1">Settings</Typography>
      <Typography variant="body-large">Manage your workspace preferences.</Typography>
    </div>

    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>This information is visible to your team.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* inputs read correctly because they sit on the card's bg-surface */}
        <Input placeholder="Full name" />
        <Select>
          <SelectTrigger><SelectValue placeholder="Role" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="member">Member</SelectItem>
          </SelectContent>
        </Select>
        <Button type="submit">Save</Button>
      </CardContent>
    </Card>
  </div>
);
```

## Props (`DashboardLayoutProps`)

### Required

| Prop | Type | Notes |
|---|---|---|
| `userName` | `string` | Shown in the account dropdown. |
| `currentRoute` | `string` | Current pathname. Drives sidebar active state and breadcrumb auto-derivation. |
| `children` | `ReactNode` | Page content. |

### Identity / branding

| Prop | Type | Notes |
|---|---|---|
| `userEmail` | `string?` | Shown under `userName` in the account dropdown. |
| `profilePicture` | `string?` | URL or base64. Falls back to initials. |
| `badges` | `ReactNode?` | Slot for role badges next to the user name. Pass `<Badge variant="purple">…` etc. |
| `companyLogo` | `string?` | URL or base64. Rendered in the navbar's left slot or breadcrumb area depending on agenda count. |
| `appName` | `string?` | Text label after the company logo (e.g. "Dashboard UI"). |

### Auth

| Prop | Type | Notes |
|---|---|---|
| `signOut` | `() => void` | Called from the account dropdown's "Sign out" item. |
| `signOutFromAccount` | `(account?: RichRadioOption) => void` | For multi-account apps. |
| `signOutOfAllAccounts` | `() => void` | Multi-account. |
| `signInWithDifferentAccount` | `() => void` | Multi-account. |
| `allowSwitchingAccounts` | `boolean?` | Enables the multi-account UI. |
| `accounts` | `RichRadioOption[]?` | Account list. |
| `selectedAccount` | `RichRadioGroupProps["value"]?` | Current account. |
| `setSelectedAccount` | `RichRadioGroupProps["onChange"]?` | Account switcher handler. |

### Navigation / routing

| Prop | Type | Notes |
|---|---|---|
| `sidebarRoutes` | `IRoute[]?` | Sidebar items. `IRoute` = required `id`, `name`, `icon`, `path`, `agenda`; optional `isActive`, `roles`. **No `subRoutes`.** `icon` is a **rendered node** — pass `<MyIcon />` (or a string), **not** a component reference. (`lucide-react` / `react-icons` are available transitively.) |
| `agendas` | `IRoute[]?` | Top-level "agendas" rendered in the waffle menu. |
| `siteMap` | `SiteMapNode[]?` | Tree built from your `ROUTE_DEFINITIONS` via `buildSiteMap()`. Enables deep-path breadcrumbs. |
| `breadcrumbs` | `Array<{ name: string; route?: string }>?` | Explicit breadcrumb trail — overrides `siteMap` and auto-derivation. |
| `LinkComponent` | `ElementType?` | The framework's link component (e.g. `next/link`'s `Link`, `react-router`'s `Link`). The library renders it for every internal nav item and passes **both `href` and `to`**, so Next's `Link` (`href`) and React Router's `Link` (`to`) work with no adapter. |
| `ImageComponent` | `ElementType?` | The framework's image component (e.g. `next/image`). Used for the company logo. **Optional** — `companyLogo` renders fine without it (falls back to a plain `<img>`). |

### Breadcrumb resolution (priority order)

`DashboardLayoutProvider` resolves breadcrumbs in this order:

1. **`breadcrumbs` prop** — explicit, highest priority. Use when you need full manual control (e.g. dynamic detail pages with parent IDs).
2. **`siteMap` prop** — call `buildSiteMap(ROUTE_DEFINITIONS)` once and pass it in. The provider walks the tree to find the current route at any depth and builds the trail.
3. **`sidebarRoutes` + `currentRoute` fallback** — shallow matching: tries to find a single `IRoute` whose `path === currentRoute` and infers `agenda → currentRoute`. Works for flat apps; breaks on nested routes.

```tsx
// Pattern 1 — explicit
<DashboardLayout
  currentRoute={pathname}
  breadcrumbs={[
    { name: "Customers", route: "/customers" },
    { name: customer.name },  // last item has no route
  ]}
/>

// Pattern 2 — siteMap (recommended for most apps)
import { buildSiteMap } from "@itixo/component-library";
const SITE_MAP = buildSiteMap({
  "/dashboard": { name: "Dashboard" },
  "/customers": { name: "Customers" },
  "/customers/:id": { name: "Customer detail" },
});
<DashboardLayout currentRoute={pathname} siteMap={SITE_MAP} />
```

### Settings dialog

| Prop | Type | Notes |
|---|---|---|
| `allowSettingsDialog` | `boolean?` | Shows the gear icon in the account dropdown. |
| `allowTheming` | `boolean?` | Light/dark/system toggle in settings. |
| `allowCustomPrimaryColor` | `boolean?` | Enables the primary-color picker. |
| `settingsTabs` | `TabType[]?` | Add extra tabs to the settings dialog. |

### Role view

| Prop | Type | Notes |
|---|---|---|
| `allowRoleViewSwitch` | `boolean?` | Shows the role-view dropdown. |
| `roleViewOptions` | `RoleViewOption[]?` | Available role views. |
| `roleViewValue` | `string?` | Current role. |
| `onRoleViewChange` | `(value: string) => void?` | Handler. |
| `roleViewLabel` | `string?` | Label for the dropdown. |

### Navbar extras

| Prop | Type | Notes |
|---|---|---|
| `NavbarActions` | `ReactNode?` | Slot for extra navbar buttons (e.g. notification bell). Use the exported `<NavbarNotificationsTrigger unreadCount={n} />` as a base. |
| `tooltipDelayDuration` | `number?` | Global tooltip delay (ms). |
| `homeRoute` | `string?` | Route the navbar logo links to. Defaults to `"/"`. Set to an absolute URL or a path outside the current `basePath` when the app is embedded in a larger system and the home action should navigate outside the app's own routing. |

### Top stripe banner

| Prop | Type | Notes |
|---|---|---|
| `stripeMessage` | `string?` | Renders a `LayoutStripe` across the top with this text. |
| `stripeVariant` | `"info" \| "warning" \| ...` | Variant (see `layoutRibbonVariants`). |
| `stripeClassName` | `string?` | Extra classes. |

## Migration notes

These are the bumps to watch for when upgrading a consumer app. For the version you actually have, check `node_modules/@itixo/component-library/package.json` and diff the bundled types (`dist/types/index.d.ts`) against your current usage.

- **0.5.0** — `IRoute` relaxed: `isActive` and `roles` are now **optional** (they were required boilerplate — `roles` is unused by the library, `isActive` is only an optional override). `icon` is now typed `ReactNode` — pass a rendered element `<Icon />` (or a string), not a component reference; it **stays required** (an iconless sidebar/waffle looks broken). `id`/`name`/`path`/`agenda` also stay required. No code changes needed for existing full-shape routes.
- **0.3.0** — `currentRouteName` and `currentAgenda` were **removed** from `AuthenticatedLayout` and `NavbarBreadcrumbPage`. Replace with `breadcrumbs` or `siteMap` (preferred). `buildSiteMap()` and the `SiteMapNode` type were added.
- **0.2.12** — `LayoutRibbon` was renamed to **`LayoutStripe`**. Update imports.
- **0.2.11** — Stripe-related props were renamed: `ribbonMessage` → `stripeMessage`, `ribbonVariant` → `stripeVariant`, `ribbonClassName` → `stripeClassName`.
- **0.3.1** — `onSelectedRowChange` on `GenericTableProvider` now receives `RowId[]` (= `string | number`) instead of `number[]`. Update consumer callbacks.

## Related exports worth knowing

- `Navbar`, `NavbarAccountDropdown`, `NavbarBreadcrumbHorizon`, `NavbarBreadcrumbPage`, `BurgerMenu`, `WaffleMenu`, `NavbarNotificationsTrigger` — the navbar building blocks, in case you want to compose your own shell instead of using `DashboardLayout` directly.
- `DashboardLayoutContainer` — exported so you can wrap your own sidebar-aware layout if needed.
- `ProfilePicture` — standalone avatar with fallback initials.
