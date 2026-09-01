# `DashboardLayout` — the ITIXO app shell

> **Breaking in 1.0 — `DashboardLayout` with grouped props, a provider `config`, and strict typography.**
> - `AuthenticatedLayout` / `AuthenticatedLayoutContainer` are **deprecated aliases** — the 1.4.0 changelog announced their removal but both are still exported as of 1.9.1. Don't use them in new code; migrate existing usage to `DashboardLayout` / `DashboardLayoutContainer` (identical props).
> - **Props are grouped** into nested objects (no longer a flat list): `user`, `navbar`, `navigation`, `stripe`, `roleView`, `accountSwitching`, `settings`, `adapters`; `currentRoute`, `children`, `slots` stay top-level. Map: `userName`→`user.name`, `companyLogo`/`appName`/`NavbarActions`→`navbar.*` (`actions`), `sidebarRoutes`/`siteMap`/`agendas`/`homeRoute`→`navigation.*`, `stripeMessage`→`stripe.message`, `allowRoleViewSwitch`→`roleView.allow`, `allowSwitchingAccounts`/`accounts`/`selectedAccount`→`accountSwitching.*` (`allow`/`accounts`/`selected`/`onSelect`), `allowSettingsDialog`/`settingsTabs`/`settingsContentClassName`→`settings.*` (`allow`/`tabs`/`contentClassName`), `LinkComponent`/`ImageComponent`→`adapters.Link`/`adapters.Image`.
> - Mount **`ComponentLibraryProvider`** once at your app root with a single **`config`** prop. It bundles `TooltipProvider`, the library i18n provider, `ColorSchemeProvider`, and the `Toaster` (no manual `<Toaster />`). **Theming moved here:** `config={{ tooltipDelayDuration?, allowTheming?, allowCustomPrimaryColor?, allowCustomTypography?, language?, toaster? }}` — `language` is a BCP 47 tag for the library's own UI strings (`"en"` default, `"cs"`), `toaster` is forwarded to the built-in sonner `Toaster` (`theme` is library-managed and cannot be overridden; `toastOptions` is merged with, not replacing, the library defaults).
> - **`config.allowCustomTypography`** defaults to **`false` (strict)**: in development, a raw Tailwind font-size (`text-sm`, `text-lg`, …) in your code or in a `className` passed to a library component **throws** — use `<Typography>` / `typographyVariants()` (the library type scale: `text-heading-1`, `text-base`, `text-small-text`, …). Set `true` to opt out.
> - **`slots`** swaps any region, defaults for the rest: `slots.stripe`, `slots.sidebar`, `slots.navbar` (full replacement `slots={{ navbar: <MyNavbar/> }}` or per sector `slots={{ navbar: { left, center, right } }}`), `slots.footer` (full replacement — bypasses `footer.variant`/`navigationSections`/etc.; `footer.position` still controls sticky vs. scroll), `slots.portalBanner` (replaces the back-to-portal banner in the waffle menu *and* the burger drawer; `navigation.portal` is then ignored). Exported: `DashboardLayoutSlots`, `NavbarSectors`, `NavbarSectorLeft`, `NavbarSectorRight`.
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

Verified against the library source at **1.9.1** (`src/library/providers/DashboardLayoutProvider.tsx`). Props are grouped — everything except `children`, `currentRoute` and `slots` lives inside a nested object.

### Top level

| Prop | Type | Notes |
|---|---|---|
| `currentRoute` | `string` | **Required.** Current pathname. Drives sidebar active state and breadcrumb derivation. |
| `children` | `ReactNode` | **Required.** Page content, rendered in the already-padded scroll area. |
| `user` | `DashboardUser` | **Required** (inside it, only `user.name` is required). |
| `slots` | `DashboardLayoutSlots?` | Region overrides; omitted slots render the library default. |
| `navbar` | `DashboardNavbar?` | Navbar branding + custom actions. |
| `navigation` | `DashboardNavigation?` | Routing + breadcrumbs. |
| `stripe` | `DashboardStripe?` | Top banner. |
| `roleView` | `DashboardRoleView?` | Role-view switcher. |
| `accountSwitching` | `DashboardAccountSwitching?` | Multi-account switching. |
| `settings` | `DashboardSettings?` | Settings dialog. |
| `adapters` | `DashboardAdapters?` | Host-framework link/image injection. |
| `footer` | `FooterConfig?` | Footer rendered inside the content area (added in 1.4.0). |

### `user` — `DashboardUser`

| Key | Type | Notes |
|---|---|---|
| `name` | `string` | **Required.** Shown in the account dropdown. |
| `email` | `string?` | Shown under `name`. |
| `profilePicture` | `string?` | URL or base64. Falls back to initials. |
| `badges` | `ReactNode?` | Role badges next to the user name, e.g. `<Badge variant="purple">Admin</Badge>`. |
| `signOut` | `(() => void)?` | Called from the account dropdown's "Sign out" item. |

### `navbar` — `DashboardNavbar`

| Key | Type | Notes |
|---|---|---|
| `companyLogo` | `string?` | URL or base64, shown in the navbar's left sector. |
| `appName` | `string?` | Text label after the logo (e.g. "Dashboard UI"). |
| `actions` | `ReactNode?` | Extra buttons in the right sector. Use the exported `<NavbarNotificationsTrigger unreadCount={n} />` as a base. |

### `navigation` — `DashboardNavigation`

| Key | Type | Notes |
|---|---|---|
| `sidebarRoutes` | `IRoute[]?` | Sidebar items — and the gate for the default sidebar (no `sidebarRoutes`, no sidebar). `IRoute` = required `id`, `name`, `icon`, `path`, `agenda`; optional `isActive`, `roles`. **No `subRoutes`.** `icon` is a **rendered node** — pass `<MyIcon />` (or a string), not a component reference. |
| `siteMap` | `SiteMapNode[]?` | Tree from `buildSiteMap(ROUTE_DEFINITIONS)`. Enables deep-path breadcrumbs. |
| `breadcrumbs` | `BreadcrumbItem[]?` | Explicit trail `{ name, route? }[]` — highest priority, overrides `siteMap`. Last item omits `route`. |
| `agendas` | `IRoute[]?` | Top-level agendas rendered in the waffle menu. |
| `portal` | `PortalLink?` | Portal the app was opened from. `{ href, name?, logo?, description?, target?, onClick? }` — `logo` is an image URL / base64 (rendered through `adapters.Image` when set) or any node; `description` is a second line under the name. Renders an inset gradient card linking back — above the search field and tiles in the waffle menu, and under the header in the mobile burger drawer. Set on its own it shows the waffle trigger even without `agendas`. Absolute `href`s always render a plain `<a>`, bypassing `adapters.Link`. Retheme via `--waffle-portal-background` / `--waffle-portal-gradient-to` / `--waffle-portal-foreground`. To own the markup, use `slots.portalBanner` instead. |
| `homeRoute` | `string?` | Route the navbar logo links to. Defaults to `"/"`. Set an absolute URL or a path outside the current `basePath` when the app is embedded in a larger system. |
| `areParamsHidden` | `boolean?` | Trims a derived breadcrumb trail at the named route, hiding URL params. |

### `stripe` — `DashboardStripe`

| Key | Type | Notes |
|---|---|---|
| `message` | `string?` | Renders a `LayoutStripe` across the top with this text. Unset/empty hides it. |
| `variant` | `VariantProps<typeof layoutRibbonVariants>["variant"]` | Stripe variant. |
| `className` | `string?` | Extra classes. |

### `roleView` — `DashboardRoleView`

| Key | Type | Notes |
|---|---|---|
| `allow` | `boolean?` | Shows the role-view dropdown. |
| `options` | `RoleViewOption[]?` | Available role views. |
| `value` | `string?` | Current role-view value. |
| `onChange` | `((value: string) => void)?` | Change handler. |
| `label` | `string?` | Label for the dropdown. |

### `accountSwitching` — `DashboardAccountSwitching`

| Key | Type | Notes |
|---|---|---|
| `allow` | `boolean?` | Enables the multi-account UI. |
| `accounts` | `RichRadioOption[]?` | Account list. |
| `selected` | `RichRadioGroupProps["value"]?` | Currently selected account. |
| `onSelect` | `RichRadioGroupProps["onChange"]?` | Account-switcher handler. |
| `signOutFromAccount` | `((account?: RichRadioOption) => void)?` | Sign out of one account. |
| `signInWithDifferentAccount` | `(() => void)?` | Start a sign-in flow for another account. |

### `settings` — `DashboardSettings`

| Key | Type | Notes |
|---|---|---|
| `allow` | `boolean?` | Shows the gear icon (settings dialog) in the account dropdown. |
| `tabs` | `TabType[]?` | Extra tabs for the settings dialog. |
| `contentClassName` | `string?` | Classes for the settings modal content area (e.g. `h-96` to keep a fixed height across tabs). |

> **Theming is not a `DashboardLayout` prop.** `allowTheming`, `allowCustomPrimaryColor`, `allowCustomTypography`, `tooltipDelayDuration`, `language` and `toaster` live on `ComponentLibraryProvider`'s `config` — see the callout at the top of this file.

### `adapters` — `DashboardAdapters`

| Key | Type | Notes |
|---|---|---|
| `Link` | `ElementType?` | The framework's link component (`next/link`, react-router's `Link`). The library passes **both `href` and `to`**, so either works with no wrapper. |
| `Image` | `ElementType?` | The framework's image component (e.g. `next/image`), used for the company logo. **Optional** — `companyLogo` falls back to a plain `<img>`. |

### `footer` — `FooterConfig`

Renders the library `Footer` at the bottom of the content area. Keys: `variant` (`FooterVariant`), `navigationSections`, `legalLinks`, `description`, `contact`, `socialLinks`, `yearEstablished`, `position` (`FooterPosition.Scroll` | `FooterPosition.Sticky`), `customFooter`. Sticky positioning is desktop-only — on mobile the footer always scrolls. `slots.footer` replaces the whole footer area (everything above except `position` is then ignored).

### `slots` — `DashboardLayoutSlots`

| Slot | Default it replaces |
|---|---|
| `stripe` | `LayoutStripe` (driven by `stripe.message`). |
| `sidebar` | `Sidebar`. The default is gated on `navigation.sidebarRoutes`; a `sidebar` slot renders unconditionally. |
| `navbar` | The navbar. A `ReactNode` replaces the whole frame; a `NavbarSectors` object (`{ left?, center?, right? }`) overrides individual positional sectors and keeps the frame. |
| `portalBanner` | `PortalBanner` in **both** the waffle menu and the mobile burger drawer; `navigation.portal` is then ignored — you own the markup, margins included. |
| `footer` | The footer area rendered from `footer`. `footer.position` still controls sticky vs. scroll. |

### Breadcrumb resolution (priority order)

`DashboardLayoutProvider` resolves breadcrumbs in this order:

1. **`navigation.breadcrumbs`** — explicit, highest priority. Use when you need full manual control (e.g. dynamic detail pages with parent IDs).
2. **`navigation.siteMap`** — call `buildSiteMap(ROUTE_DEFINITIONS)` once and pass it in. The provider walks the tree to find the current route at any depth and builds the trail. `navigation.areParamsHidden` trims the trail at the named route.
3. **`navigation.sidebarRoutes` + `currentRoute` fallback** — shallow matching on `path`, inferring `agenda → currentRoute`. Works for flat apps; breaks on nested routes.

```tsx
// Pattern 1 — explicit
<DashboardLayout
  currentRoute={pathname}
  user={{ name: "Prokop Dveře" }}
  navigation={{
    breadcrumbs: [
      { name: "Customers", route: "/customers" },
      { name: customer.name },  // last item has no route
    ],
  }}
/>

// Pattern 2 — siteMap (recommended for most apps)
import { buildSiteMap } from "@itixo/component-library";
const SITE_MAP = buildSiteMap({
  "/dashboard": { name: "Dashboard" },
  "/customers": { name: "Customers" },
  "/customers/:id": { name: "Customer detail" },
});
<DashboardLayout
  currentRoute={pathname}
  user={{ name: "Prokop Dveře" }}
  navigation={{ siteMap: SITE_MAP }}
/>
```

## Migration notes

These are the bumps to watch for when upgrading a consumer app. For the version you actually have, check `node_modules/@itixo/component-library/package.json` and diff the bundled types (`dist/types/index.d.ts`) against your current usage.

- **1.4.0** — `footer` prop added to `DashboardLayout` (renders the library `Footer` inside the content area) and `footer` added to `DashboardLayoutSlots`. The changelog also announces the removal of `AuthenticatedLayout` / `AuthenticatedLayoutContainer`, but **both are still exported as deprecated aliases as of 1.9.1**. Treat them as gone either way — migrate to `DashboardLayout` / `DashboardLayoutContainer`.
- **1.0.0** — Props grouped into nested objects; `ComponentLibraryProvider` takes a single `config`; the public props type `AuthLayoutContextType` was renamed to `DashboardLayoutProps`; `allowTheming` / `allowCustomPrimaryColor` moved off the layout onto the provider `config`. Full rename map in the callout at the top of this file.
- **0.5.0** — `IRoute` relaxed: `isActive` and `roles` are now **optional** (`roles` is unused by the library, `isActive` is only an optional override). `icon` is typed `ReactNode` — pass a rendered element `<Icon />` (or a string), not a component reference; it **stays required** (an iconless sidebar/waffle looks broken). `id`/`name`/`path`/`agenda` also stay required.
- **0.3.1** — `onSelectedRowChange` on `GenericTableProvider` now receives `RowId[]` (= `string | number`) instead of `number[]`. Update consumer callbacks.
- **0.3.0** — `currentRouteName` and `currentAgenda` were **removed**. Replace with `breadcrumbs` or `siteMap` (preferred). `buildSiteMap()` and the `SiteMapNode` type were added.
- **0.2.12** — `LayoutRibbon` was renamed to **`LayoutStripe`**. Update imports.
- **0.2.11** — Stripe props renamed: `ribbonMessage` → `stripeMessage`, `ribbonVariant` → `stripeVariant`, `ribbonClassName` → `stripeClassName` (all now nested under `stripe.*` since 1.0.0).

## Related exports worth knowing

- `Navbar`, `NavbarAccountDropdown`, `NavbarBreadcrumbHorizon`, `NavbarBreadcrumbPage`, `BurgerMenu`, `WaffleMenu`, `NavbarNotificationsTrigger` — the navbar building blocks, in case you want to compose your own shell instead of using `DashboardLayout` directly.
- `DashboardLayoutContainer` — exported so you can wrap your own sidebar-aware layout if needed.
- `ProfilePicture` — standalone avatar with fallback initials.
