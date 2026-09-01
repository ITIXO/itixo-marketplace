# Design system practices

The library is opinionated. These are the conventions that keep a consumer app visually and behaviorally consistent with the rest of the ITIXO ecosystem.

## Tokens, not literals

Every color, spacing value, radius, font size, and shadow lives as a CSS custom property in the library's stylesheet. Theming (light/dark, role-based primary color) flips by changing variable values — hardcoded literals can't follow.

**Don't:**

```tsx
<div className="bg-[#7c3aed] p-[12px] rounded-[8px] shadow-[0_2px_4px_rgba(0,0,0,.1)]" />
```

**Do:**

```tsx
<div className="bg-primary-600 p-3 rounded-md shadow-sm" />
```

For the full token catalog and the exact variable names, see [design-tokens.md](design-tokens.md) (or search the installed stylesheet, `node_modules/@itixo/component-library/dist/index.css`). The categories:

- `color` — `--color-primary-{50…900}`, the semantic role tokens (`--color-surface`, `--color-muted`, …), badge/chart colors.
- `spacing` — `--space-{1…8+}` (mapped to Tailwind's `p-`, `m-`, `gap-`, …)
- `radius` — `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl`, and component-specific (`--radius-btn-*`, `--radius-input`, …)
- `typography` — the named type scale: `--text-display-large`, `--text-display`, `--text-heading-1…3`, `--text-body-large`, `--text-base`, `--text-small-text`, `--text-smaller-text`, `--text-smallest-text`, `--text-label-text` (see the Typography section below). Don't use Tailwind's default `--text-sm/lg/xl/2xl…`.
- `shadow` — `--shadow-sm`, `--shadow-md`, `--shadow-lg`, plus `--shadow-card`, `--shadow-surface`

## Always merge classes with `cn()`

`cn()` is the library's `tailwind-merge` extension. It knows about library-specific class groups (`text-heading-1`, `bg-surface`, custom shadow/radius tokens) — vanilla `tailwind-merge` doesn't.

```tsx
import { cn } from "@itixo/component-library";

<Button className={cn("w-full", isLoading && "opacity-50", className)} />
```

Rules:

- Never `clsx` directly.
- Never template-string concatenation (`` `flex ${x ? "bg-red" : ""}` ``).
- Never raw string concatenation.

When the user overrides a `className` on a library component, the component internally calls `cn(defaults, props.className)` so caller classes win — leaning on this is the canonical way to customize.

## Typography

Use `<Typography>` for **all** text — including headings — not raw `<h1>`/`<h2>`/`<p>` and **never** raw Tailwind font sizes (`text-sm`, `text-lg`, `text-xl`, …). The named scale carries line-heights, weights, letter-spacing, and dark-mode color tokens; hand-rolled or default-Tailwind text drifts visually over time.

> **`Heading` is deprecated.** The old `<Heading level="h1"…"h5">` component uses raw Tailwind sizes (`text-4xl`, …) that bypass the type scale. Replace it with `<Typography>` + `as`: `h1 → variant="heading-1"`, `h2 → "heading-2"`, `h3 → "heading-3"`.

```tsx
import { Typography } from "@itixo/component-library";

<Typography variant="heading-1" as="h1">Customers</Typography>
<Typography variant="body-large">View and manage customer accounts.</Typography>
<Typography variant="small-text" as="span">12 active</Typography>
```

### Two ways to apply type

1. **`<Typography variant="…">`** — the default for everything. The optional `as` prop sets the rendered element (`as="h1"`, `as="h2"`, `as="span"`, `as="label"`, …; defaults to `p`). Pick the heading *variant* for size/weight and the matching *element* via `as` for semantics.
2. **`typographyVariants({ variant })`** — when you need the type classes inside a `cn()` call on another element:
   ```tsx
   <button className={cn(typographyVariants({ variant: "label-text" }), "px-2")} />
   ```

### Scale (variant → utility class → size)

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

The utility classes (`text-heading-1`, `text-body-large`, etc.) are valid on their own when you can't use the component — `cn()` understands them as a class group. `text-base` overlaps the Tailwind default and is fine; every other Tailwind `text-*` size bypasses the scale.

### Hierarchy rules

Use heading variants that match the information hierarchy of the page — don't pick a variant based on how it looks:

| Context | Variant |
|---|---|
| Page / view title | `heading-1` or `heading-2` |
| Card or section title | `heading-2` or `heading-3` |
| Sub-section or group label | `heading-3` or `body-large` |
| Body / paragraph copy | `base` or `body-large` |
| Supporting / meta text | `small-text` or `smaller-text` |
| Form labels, column headers | `label-text` |

**Don't:**
- Use `heading-1` for every title regardless of nesting level.
- Put a `heading-1` inside a card that's already a child of another `heading-1` section.
- Use `body-large` as a heading because it "looks about right".

**Do:** pick the variant by semantic level first, then verify the size feels appropriate in context. If the size feels wrong, revisit the layout — don't compensate by bumping the variant up or down.

## Surfaces & contrast (Card-first)

The layout has two distinct background tokens — getting them wrong is the most common visual mistake:

| Token | Tailwind class | Light | Dark | Use for |
|---|---|---|---|---|
| `--background` | `bg-background` | light gray | near-black | the page/layout backdrop only |
| `--surface` / `--card` | `bg-surface` / `bg-card` | white | dark surface | content containers (`Card`, dialogs, popovers) |

**Rule: put content on a surface, not on the raw background.** Text and especially form controls placed directly on `bg-background` look washed-out (gray-on-gray). Wrap page content in `<Card>`:

```tsx
import { Card, CardHeader, CardTitle, CardContent } from "@itixo/component-library";

// ✓ readable — content sits on bg-surface
<Card>
  <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
  <CardContent className="space-y-4">
    <Input placeholder="Full name" />
    <Select> … </Select>
  </CardContent>
</Card>

// ✗ low contrast — text + transparent inputs directly on bg-background
<div className="space-y-4">
  <h2 className="text-xl">Profile</h2>
  <Input placeholder="Full name" />
</div>
```

`Card` is `bg-card text-card-foreground rounded-2xl py-6 shadow-card`; its sub-parts (`CardHeader`, `CardContent`, `CardFooter`) add the horizontal `px-6`. Always use those sub-components as Card's direct children — never raw content directly inside `Card`.

**Why form controls especially need this:** `Input`, `Select`, and `Textarea` have a **transparent** background by default (`--input-background` / `--select-trigger-background` resolve to `transparent` in light mode). On a surface they read correctly; on `bg-background` they nearly disappear. So every form belongs inside a Card or another `bg-surface` container.

## Color scheme (light / dark / role-based)

Theming is class-driven (à la `next-themes`):

- `DashboardLayout` wires `ColorSchemeProvider` for you automatically.
- For apps that don't use `DashboardLayout`, wrap the tree in `ColorSchemeProvider` yourself.
- Theme tokens flip via CSS — you don't need to read the current theme in components.

If you need to set a custom primary color at runtime (e.g. per-tenant branding):

```tsx
import { setCssVariables, parseColor } from "@itixo/component-library";

setCssVariables({ "--color-primary-500": parseColor(tenant.primaryHex) });
```

## Forms

The library wraps `react-hook-form` + `zod` in a small set of components that keep field/label/error wiring consistent. Prefer these over hand-rolling:

```tsx
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, Input, Button } from "@itixo/component-library";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

const schema = z.object({ email: z.string().email() });

const MyForm = () => {
  const form = useForm({ resolver: zodResolver(schema) });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit">Submit</Button>
      </form>
    </Form>
  );
};
```

Available form primitives via the barrel: `Form`, `FormControl`, `FormDescription`, `FormField`, `FormItem`, `FormLabel`, `FormMessage`, `useFormField`. Inputs: `Input`, `Textarea`, `Select`, `Checkbox`, `CheckboxGroup`, `RichCheckboxGroup`, `RadioGroup`, `RadioGroupItem`, `RichRadioGroup`, `Switch`, `SwitchGroup`, `SwitchGroupBox`, `InputOTP`, `SearchBarInput`, `Slider`.

## Dialog & Popover action buttons

When a `Dialog`, `AlertDialog`, or `Popover` contains a pair of Cancel and Confirm actions, follow this layout contract:

- **Both buttons are right-aligned** — use `flex justify-end gap-2` on the footer container (or use `DialogFooter` which already does this).
- **Order (left → right):** Cancel first, then Confirm — regardless of the action label language.
- **Variants:** Cancel → `variant="outline"`, Confirm → `variant="default"` (primary).

```tsx
import { Button, DialogFooter } from "@itixo/component-library";

<DialogFooter>
  <Button variant="outline" onClick={onClose}>Cancel</Button>
  <Button variant="default" onClick={onConfirm}>Save changes</Button>
</DialogFooter>
```

This applies to any confirm/dismiss pair regardless of wording — "Close"/"Apply", "Discard"/"Continue", "No"/"Yes", etc.

## Button loading states

Any `Button` that triggers an async operation (API call, form submit, file upload, etc.) must:

1. **Preserve its width** — use a fixed or minimum width so the button doesn't shrink when text is replaced by a spinner.
2. **Show a `Spinner`** inside the button while loading.
3. **Be disabled** while loading (`disabled={isLoading}`) to prevent double-submission.

```tsx
import { Button, Spinner } from "@itixo/component-library";

<Button
  type="submit"
  disabled={isLoading}
  className="min-w-[120px]"
>
  {isLoading ? <Spinner size="sm" /> : "Save changes"}
</Button>
```

`Spinner`'s `size` is `"sm" | "md" | "lg"` (16 / 24 / 32 px) or a pixel number. (The older `width` / `height` props still work but are **deprecated** — prefer `size`.)

Don't hide the button, replace it with a different element, or rely solely on visual opacity — the disabled + spinner pattern is consistent across ITIXO apps.

## Destructive actions

Any action that is permanent or hard to reverse — Delete, Remove, Reset, Archive, Revoke, etc. — must be confirmed via `AlertDialog` before the mutation fires. Never wire a destructive API call directly to a button's `onClick`.

```tsx
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
  Button,
} from "@itixo/component-library";

<AlertDialog>
  <AlertDialogTrigger asChild>
    <Button variant="destructive">Delete customer</Button>
  </AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Delete customer?</AlertDialogTitle>
      <AlertDialogDescription>
        This action cannot be undone. The customer and all associated data will be permanently removed.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

`AlertDialogAction` automatically uses the destructive/primary style. `AlertDialogFooter` follows the same right-aligned Cancel→Confirm layout contract described above.

## Tables

Two paths, pick by use case:

- **Static / client-controlled** — use raw `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`, `TableCaption`, `TableFooter`. Style by passing classes to rows/cells.
- **Server-driven** — wrap in `GenericTableProvider` and render `GenericTable`. Pagination, sorting, and filtering state are managed externally (you control fetches). `RowId` is `string | number` since 0.3.1.

```tsx
import { GenericTableProvider, GenericTable } from "@itixo/component-library";

<GenericTableProvider
  tableData={{ headers, rows }}
  onPageChange={setPage}
  onSortChange={setSort}
  onSelectedRowChange={setSelectedIds}
>
  <GenericTable />
</GenericTableProvider>
```

Don't import deep paths from `GenericTable/` — everything is re-exported from the barrel.

## Toasts

Two surfaces. The library ships both — pick **one**:

- `Toaster` + `toast()` from the library wrap `sonner`. Mount `<Toaster />` once at the root.
- `react-hot-toast` is also a transitive dep, but prefer the library's `toast` because the styling is themed.

```tsx
import { Toaster, toast } from "@itixo/component-library";

// in app root:
<Toaster />

// anywhere — `toast.*()` takes an options object, not a string:
toast.success({ title: "Saved" });
toast.error({ title: "Couldn't save", description: "Try again." });
```

## What NOT to do

- **Don't fork library components into the consumer app.** If a component is missing or buggy, request it upstream. A forked copy will drift and break theming.
- **Don't restyle library components with arbitrary Tailwind that bypasses tokens.** Use the variant/size props the component exposes; only fall back to `className` for layout/spacing.
- **Don't mix raw shadcn copies and library exports.** They look similar but the library's versions are tuned for ITIXO's token set and the custom `cn()`. Importing the shadcn version side-by-side leads to visual drift and double Radix providers.
- **Don't import from `@itixo/component-library/dist/...` deep paths.** Use the package root (`@itixo/component-library`) for everything except the one CSS side-effect.
- **Don't recreate `cn`, `Button`, `Input`, `Dialog`, `DropdownMenu`, `Toaster`, etc.** Check [components.md](components.md) first — the library probably already has it.
