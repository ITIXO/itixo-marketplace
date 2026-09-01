# Design tokens

Every color, spacing value, radius, font size, and shadow lives as a CSS custom property in the library's compiled stylesheet. Theming (light/dark, role-based primary color) flips by changing variable values — hardcoded literals can't follow. Use the token-backed Tailwind utilities (`bg-primary`, `p-3`, `rounded-md`, `shadow-sm`, `text-heading-1`) instead of arbitrary values (`bg-[#7c3aed]`, `p-[12px]`, …).

**Authoritative source for exact names/values:** the installed stylesheet, `node_modules/@itixo/component-library/dist/index.css`. Every `--token` is defined there for the version you have installed. This file mirrors the catalog for quick scanning; when they disagree, the CSS wins. To find a token, search that file (e.g. for `--color-primary`, `--radius`, `--shadow`, `--text-`).

## Colors (`--color-*`)

**Semantic (role) tokens** — these flip between light/dark and are what you should reach for first:

- `--color-background`, `--color-foreground` — page backdrop + its text (`bg-background`, `text-foreground`).
- `--color-surface`, `--color-surface-foreground`, `--color-surface-border` — content surfaces. Also `--color-card`, `--color-card-foreground` (`bg-card` / `bg-surface`).
- `--color-popover`, `--color-popover-foreground` — overlays.
- `--color-primary`, `--color-primary-foreground`, plus the ramp `--color-primary-50 … --color-primary-900`.
- `--color-secondary`, `--color-secondary-foreground`.
- `--color-muted`, `--color-muted-foreground`.
- `--color-accent`, `--color-accent-foreground`.
- `--color-destructive`, `--color-destructive-foreground`; `--color-warning`, `--color-warning-foreground`.
- `--color-border`, `--color-input`, `--color-input-background`, `--color-ring`, `--color-ring-invalid`.
- Sidebar: `--color-sidebar-active-background`, `--color-sidebar-active-foreground`, `--color-sidebar-hover-background`, `--color-sidebar-inactive-foreground`.

**Badge colors:** `--color-badge-{primary,red,green,blue,yellow,purple,pink,orange,cyan}` and matching `-foreground` variants (drive the `Badge` color variants).

**Chart colors:** `--color-chart-1 … --color-chart-5`.

**Raw palette ramps** (use only when a semantic token doesn't fit) — each as `-50 … -900`: `gray`, `amber`, `blue`, `cyan`, and others. Prefer the semantic tokens above; raw ramps don't respond to role/theme changes.

## Spacing (`--space-*`)

`--space-1 … --space-8` (and up). Mapped to Tailwind's `p-`, `m-`, `gap-`, `space-y-`, etc. — use those utilities (`p-3`, `gap-4`) rather than arbitrary pixel values.

## Radius (`--radius-*`)

`--radius-none`, `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl`, `--radius-2xl`, `--radius-3xl`, `--radius-4xl`, `--radius-full`. Component-specific: `--radius-btn-{mini,sm,md,lg}`, `--radius-input`, `--radius-select-trigger`, `--radius-select-content`, `--radius-select-item`. Use `rounded-md`, `rounded-2xl`, etc.

## Shadow (`--shadow-*`)

`--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--shadow-xl`, `--shadow-2xl`, `--shadow-3xl` (each with `-light`/`-dark` pairs), plus named aliases `--shadow-small`, `--shadow-medium`, `--shadow-large`, `--shadow-extralarge`, `--shadow-2extralarge`, `--shadow-3extralarge`, and the role shadows `--shadow-card`, `--shadow-surface`, `--shadow-inset`. Use `shadow-sm`, `shadow-card`, etc.

## Typography (`--text-*`) — the named type scale

Use `<Typography variant="…">` for all text, or the matching utility class on another element. Each scale step also defines `--text-<name>--line-height` and `--text-<name>--letter-spacing`.

| `Typography` variant | Utility class | Size |
|---|---|---|
| `display-large` | `text-display-large` | 2rem |
| `display` | `text-display` | 1.81rem |
| `heading-1` | `text-heading-1` | 1.63rem |
| `heading-2` | `text-heading-2` | 1.44rem |
| `heading-3` | `text-heading-3` | 1.25rem |
| `body-large` | `text-body-large` | 1.13rem |
| `base` (default) | `text-base` | 1rem |
| `small-text` | `text-small-text` | 0.875rem |
| `smaller-text` | `text-smaller-text` | 0.81rem |
| `smallest-text` | `text-smallest-text` | 0.625rem |
| `label-text` | `text-label-text` | 0.875rem, uppercase |

`text-base` overlaps the Tailwind default and is fine; every **other** Tailwind `text-*` size (`text-sm`, `text-lg`, `text-xl`, `text-2xl`, …) bypasses the scale — don't use them.

## Setting a custom primary color at runtime

```tsx
import { setCssVariables, parseColor } from "@itixo/component-library";

setCssVariables({ "--color-primary-500": parseColor(tenant.primaryHex) });
```
