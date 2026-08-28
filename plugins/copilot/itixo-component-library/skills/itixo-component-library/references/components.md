# Component reference

The catalog of everything `@itixo/component-library` exports, with the props that matter. This is the static replacement for "ask the package what's available / what props does X take" — it is generated from the package's bundled type definitions (`dist/types/index.d.ts`) and the JSDoc on the source components.

**For an exact, up-to-date answer, query the `itixo-component-library` MCP server first** (`get_component_props`, `list_components`, `search_component`, `get_component_example`) rather than grepping `node_modules`. The offline fallback is the installed package's own types: `node_modules/@itixo/component-library/dist/types/index.d.ts` — every export, prop type, and JSDoc comment lives there and always matches the version you actually have installed. This document mirrors it for quick scanning; when they disagree, the `.d.ts` (or MCP server) wins.

All components import from the package root:

```tsx
import { Button, Dialog, Card, cn } from "@itixo/component-library";
```

Conventions used below:
- Components not listed with explicit props are thin wrappers over their Radix/headless primitive and accept that primitive's props plus `className`.
- "✎ JSDoc" marks exports that carry documentation comments in the `.d.ts` — hover them in your editor for the full text.

---

## UI primitives & display

| Export(s) | Notable props |
|---|---|
| `Accordion`, `AccordionItem`, `AccordionTrigger`, `AccordionContent` | Radix Accordion passthrough. |
| `Alert`, `AlertTitle`, `AlertDescription` | `Alert` `variant`: `default` \| `destructive`. |
| `AspectRatio` | Radix AspectRatio passthrough. |
| `Avatar`, `AvatarImage`, `AvatarFallback` | Radix Avatar passthrough. |
| `Badge` | `variant`: `default` \| `destructive` \| `outline` \| `secondary` \| `custom` \| `red` \| `green` \| `blue` \| `yellow` \| `purple` \| `pink` \| `orange` \| `cyan`; `asChild`. |
| `BadgeOverlay` | `children`, `content?`, `dot?`, `origin?` (`topLeft`\|`topRight`\|`bottomLeft`\|`bottomRight`), `bordered?`, `overlap?`, `icon?`. |
| `Button` | `variant`: `default` \| `destructive` \| `outline` \| `secondary` \| `ghost` \| `link` \| `inline`; `size`: `default` \| `sm` \| `lg` \| `icon` \| `mini`; `asChild`. |
| `IconButton` | `variant` (Button variants), `size`: `default` \| `lg` \| `sm` \| `icon` \| `mini`, `asChild`. |
| `Card` ✎, `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`, `CardContent`, `CardFooter` | Always use the sub-parts as direct children of `Card` — never raw content. For edge-to-edge content (tables) use `<CardContent className="p-0">` and add `className="overflow-hidden p-0 gap-0"` to `Card`. |
| `Carousel`, `CarouselContent`, `CarouselItem`, `CarouselPrevious`, `CarouselNext` | `Carousel` `orientation`: `horizontal`\|`vertical`, `opts`, `plugins`, `setApi`. Type: `CarouselApi`. |
| `Progress` | `value`. |
| `Separator` | `orientation`, `decorative`. |
| `Skeleton` | `<div>` passthrough. |
| `Spinner` | `size?` (`"sm"` \| `"md"` \| `"lg"` \| number; 16/24/32px, default `"md"`). `width?`/`height?` deprecated — use `size`. |
| `Typography` ✎, `typographyVariants` | `variant` (see the type scale in [design-tokens.md](design-tokens.md)); `as` to set the element (`h1`/`h2`/`span`/`label`/…). Use for **all** text. |
| `Heading` ⚠️ deprecated | Use `<Typography variant="heading-1" as="h1">` instead. |
| `Calendar`, `CalendarDayButton` | react-day-picker; `captionLayout`, `buttonVariant`, `showOutsideDays`, `defaultMonth`. |
| `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` | Radix Collapsible passthrough. |
| `ScrollArea`, `ScrollBar` | Radix ScrollArea passthrough. |
| `ResizablePanelGroup`, `ResizablePanel`, `ResizableHandle` | `ResizableHandle` `withHandle?`. |

## Tables (static)

`Table`, `TableHeader`, `TableBody`, `TableFooter`, `TableHead`, `TableRow`, `TableCell`, `TableCaption`.

- `Table` — `striped?`.
- `TableHead`, `TableCell` — `sticky?`: `boolean | "right"`.

For server-driven tables use `GenericTable` (below).

## Forms & inputs

| Export(s) | Notable props |
|---|---|
| `Form`, `FormControl`, `FormDescription`, `FormField`, `FormItem`, `FormLabel`, `FormMessage` | `react-hook-form` wrappers. See the form example in [design-system-guidelines.md](design-system-guidelines.md). |
| `Input` | `<input>` passthrough. Transparent background — keep on a surface. |
| `Textarea` | `<textarea>` passthrough. Transparent background. |
| `Label` | Radix Label passthrough. |
| `Checkbox` | `variant`: `default` \| `disabled` \| `error` \| `focus` \| `destructive` \| `errorFocus` \| `success`; `asChild`. |
| `CheckboxGroup` | `title`, `checked` (`boolean \| "indeterminate"`), `setChecked`, `disabled?`, `variant?`. |
| `RichCheckboxGroup` | `title`, `description`, `checked`, `setChecked`. |
| `RadioGroup`, `RadioGroupItem` | Radix RadioGroup passthrough. |
| `RichRadioGroup` | `options: RichRadioOption[]`, `value`, `onChange`, `size?`: `sm`\|`default`\|`lg`. `RichRadioOption` = `{ value, label, description? }`. |
| `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectGroup`, `SelectItem`, `SelectLabel`, `SelectSeparator`, `SelectScrollUpButton`, `SelectScrollDownButton` | `SelectTrigger` adds `size`: `default`\|`lg`\|`sm`\|`mini`, `variant`: `default`\|`twoLine`, `label?`, `placeholder?`. Transparent trigger — keep on a surface. |
| `MultiSelect` ✎ | Fully documented in the `.d.ts`. Key props: `options: { label, value, icon?, color? }[]`, `onValueChange: (string[]) => void`, `defaultValue?`, `placeholder?`, `maxCount?` (default 3), `minCount?`, `lockedValues?`, `multiColored?`, `modalPopover?`, `animation?`, `autoFocus?`, `asChild?`, `labels?` (i18n overrides). |
| `Switch` | Radix Switch passthrough. |
| `SwitchGroup` | `title`, `checked`, `setChecked`, `disabled?`. |
| `SwitchGroupBox` | `title`, `description`, `checked`, `setChecked`, `disabled?`. |
| `Slider` | `defaultValue`, `value`, `min`, `max`. |
| `Toggle`, `ToggleGroup`, `ToggleGroupItem` | `variant`: `default`\|`outline`; `size`: `default`\|`lg`\|`sm`. |
| `InputOTP`, `InputOTPGroup`, `InputOTPSlot`, `InputOTPSeparator` | `InputOTP` `containerClassName?`; `InputOTPSlot` `index`. |
| `SearchBarInput`, `searchBarInputVariants` | `variant`: `default`\|`transparent`; `wrapperClassName?`. |
| `useFormField` | Hook — returns the current field's `error`, `invalid`, ids, etc. Call inside a `FormField`. |

## Overlays & menus

| Export(s) | Notable props |
|---|---|
| `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`, `DialogClose`, `DialogOverlay`, `DialogPortal` | `DialogContent` `showCloseButton?`. |
| `AlertDialog`, `AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogFooter`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogAction`, `AlertDialogCancel`, `AlertDialogOverlay`, `AlertDialogPortal` | Radix AlertDialog passthrough. |
| `Drawer`, `DrawerTrigger`, `DrawerContent`, `DrawerHeader`, `DrawerFooter`, `DrawerTitle`, `DrawerDescription`, `DrawerClose`, `DrawerOverlay`, `DrawerPortal` | vaul Drawer passthrough. |
| `Sheet`, `SheetTrigger`, `SheetContent`, `SheetHeader`, `SheetFooter`, `SheetTitle`, `SheetDescription`, `SheetClose` | `SheetContent` `side`: `top`\|`right`\|`bottom`\|`left`. |
| `Popover`, `PopoverTrigger`, `PopoverContent`, `PopoverAnchor` | `PopoverContent` `align`, `sideOffset`. |
| `Tooltip`, `TooltipProvider`, `TooltipTrigger`, `TooltipContent` | `TooltipProvider` `delayDuration`; `TooltipContent` `sideOffset`. |
| `DropdownMenu` + sub-parts | `DropdownMenuItem` `inset?`, `variant`: `default`\|`destructive`; `DropdownMenuContent` `sideOffset`. Full set: `DropdownMenuTrigger`, `Content`, `Group`, `Item`, `CheckboxItem`, `RadioGroup`, `RadioItem`, `Label`, `Separator`, `Shortcut`, `Sub`, `SubTrigger`, `SubContent`, `Portal`. |
| `ContextMenu` + sub-parts | Same shape as DropdownMenu (`ContextMenuItem` `inset?`, `variant`). |
| `Menubar` + sub-parts | `MenubarItem` `inset?`, `variant`; `MenubarContent` `align`, `alignOffset`, `sideOffset`. |
| `Command`, `CommandDialog`, `CommandInput`, `CommandList`, `CommandEmpty`, `CommandGroup`, `CommandItem`, `CommandSeparator`, `CommandShortcut` | cmdk; `CommandInput` `variant`: `default`\|`transparent`. |
| `useModal` | Hook — `{ isOpen, openModal, closeModal }`. |

## Navigation & layout

| Export(s) | Notable props |
|---|---|
| `DashboardLayout` ✎ | The app shell. Full prop walkthrough in [dashboard-layout.md](dashboard-layout.md). |
| `DashboardLayoutContainer` | Sidebar-aware container if you compose your own shell. |
| `Navbar`, `NavbarAccountDropdown`, `NavbarBreadcrumbPage`, `NavbarNotificationsTrigger`, `BurgerMenu`, `WaffleMenu` | Navbar building blocks. `NavbarNotificationsTrigger` `unreadCount`; `WaffleMenu` `agendas: IRoute[]`, `className?`. |
| `NavbarBreadcrumbHorizon` ⚠️ deprecated | Use `NavbarBreadcrumbPage`. |
| `Breadcrumb`, `BreadcrumbList`, `BreadcrumbItem`, `BreadcrumbLink`, `BreadcrumbPage`, `BreadcrumbSeparator`, `BreadcrumbEllipsis` | `BreadcrumbLink` `asChild?`. |
| `NavigationMenu` + sub-parts, `navigationMenuTriggerStyle` | `NavigationMenu` `viewport?`. Sub-parts: `List`, `Item`, `Content`, `Trigger`, `Link`, `Indicator`, `Viewport`. |
| `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | `Tabs` `size`: `small`\|`regular`\|`large`. |
| `Pagination`, `PaginationContent`, `PaginationItem`, `PaginationLink`, `PaginationPrevious`, `PaginationNext`, `PaginationEllipsis` | `PaginationLink` `isActive?`, `size`. |
| `ProfilePicture` | `profilePicture?`, `userName`, `size?` (`sm`\|`md`\|`lg`\|`xl`\|`xxl`). |
| `EventCard` | `title`, `description`, `className?`. |
| `LayoutStripe`, `layoutRibbonVariants` | `isVisible`, `message`, `className?`, `variant`: `info`\|`warning`\|`critical`\|`custom`. |
| `FloorSwitchButtons` | `minLevel`, `maxLevel`, `currentLevel`, `onLevelChange`. |
| `buildSiteMap` ✎ | `buildSiteMap(routes: Record<string, { name }>) => SiteMapNode[]`. Builds a breadcrumb tree from a flat `ROUTE_DEFINITIONS` map. See [authenticated-layout.md](authenticated-layout.md). |

## Data — `GenericTable` (server-driven)

Wrap in `GenericTableProvider` and render `GenericTable`. Pagination, sorting, filtering, and selection state are all driven externally — you own the fetches.

| Export | Notable props / notes |
|---|---|
| `GenericTableProvider` | `tableData: GenericTableData \| null`, `isLoading`, `onRefetch`, `filtersStorageKey`, `children`, plus optional `onChange(state: GenericTableQueryState)`, `isRefetching?`, `detailData?`, `isDetailLoading?`, `onSelectedRowChange?(ids: RowId[])`, `onUpdateCell?`, `isUpdatingCell?`, `translate?`, `badgeMap?`, `maxColumnWidth?`. |
| `GenericTable` | `header?`, `showFilters?`, `checkboxSelection?`, `exportDataURL?`. (`headerButtons` is ⚠️ deprecated — use `header`.) |
| `GenericTableHeaderFilters` | `columns: ExtendedColumnDef[]`, `showFilters?`, `header?`, `exportDataURL?`. |
| `GenericTableModalFilters` | `columns: ExtendedColumnDef[]`. |
| `GenericTableSearchBar` | `placeholder?`, `debounceMs?`, `minChars?`, `wrapperClassName?`. |
| `GenericTableRefreshButton` | No props. |
| `GenericTableAddRowButton` ✎ | `onSubmit(data) => Promise<void>` (called on confirm), `isPending`. |
| `GenericTableExportDataModal` ✎ | Accepts the new callback API (`onExport(payload: ExportPayload) => Promise<void>`, `isPending?`) **or** the legacy `exportDataURL` string. Prefer the callback API. |
| `useGenericTableContext` | Hook — returns the full `GenericTableModel` (table instance, paging, filters, selection, etc.). |

**Helpers:** `getFiltersFromLocalStorage(key)`, `saveFiltersToLocalStorage(key, filters)`, `getColorMap(inputColor, prefix?)`.

**Types & enums:** `GenericTableData`, `GenericTableModel`, `GenericTableQueryState`, `ExtendedColumnDef`, `DownloadableColumn`, `ExportPayload`, `FilterCondition`, `FiltersState`, `FilterOperand` (enum), `TableFilterType` (enum), `TableFilterTypes` (enum: `Select`\|`Text`\|`Number`\|`Check`\|`DateTimeSelect`\|`None`), `HighlightMap`, `RowId` (= `string | number`).

## Charts

Wrappers over recharts:

- `ChartContainer` — `config: ChartConfig`, `children`.
- `ChartTooltip`, `ChartTooltipContent` — `indicator`: `line`\|`dot`\|`dashed`, `hideLabel?`, `hideIndicator?`, `nameKey?`, `labelKey?`.
- `ChartLegend`, `ChartLegendContent` — `hideIcon?`, `nameKey?`.
- `ChartStyle`, type `ChartConfig`.

Re-exported recharts primitives: `Area`, `AreaChart`, `Bar`, `BarChart`, `Line`, `LineChart`, `Pie`, `PieChart`, `PolarGrid`, `PolarRadiusAxis`, `RadialBar`, `RadialBarChart`, `CartesianGrid`, `XAxis`, `LabelList`, `RechartsLabel`, type `CurveType`.

## Toasts

- `Toaster` — mount once at the app root.
- `toast` — `toast.success / error / warning / info / loading / dismiss / custom`. Each takes `ToastOptions` (`title?`, `description?`, `onClickAction?`, `onClose?`, …). **Always pass an object — a raw string will fail TypeScript.**

```tsx
import { Toaster, toast } from "@itixo/component-library";
<Toaster />                                                    // root
// ✗ toast.success("Saved");                                   // TS error — string is not ToastOptions
// ✓
toast.success({ title: "Saved" });
toast.error({ title: "Failed", description: "Try again." });
toast.success({ title: "Project updated", description: "Changes were saved.", onClose: () => {} });
```

## Hooks

`useFormField`, `useGenericTableContext`, `useModal`.

## Utilities & functions

| Export | Purpose |
|---|---|
| `cn(...inputs)` | The library's `tailwind-merge` extension. Always use over raw `clsx`. |
| `setCssVariables(vars)` | Set CSS custom properties at runtime (e.g. per-tenant primary color). |
| `parseColor(input)` | Parse a color string to `{ r, g, b }`. |
| `hslToHex(h, s, l)`, `rgbToHsl({r,g,b})` | Color conversion. |
| `getColorMap(input, prefix?)` | Build a token map for a base color. |
| `uuidNumber()` | Numeric unique id. |

**Variant builders (cva):** `badgeVariants`, `typographyVariants`, `layoutRibbonVariants`, `toggleVariants`, `searchBarInputVariants`, `navigationMenuTriggerStyle`. Use inside `cn()` when you need a component's classes on another element.

**ESLint rules (for the consumer's config):** `allRestrictedSyntaxRules`, `noConsoleLogRule`, `noTailwindFontsizeRules`.

## Shared types & enums

`IRoute`, `SiteMapNode`, `RichRadioOption`, `RichRadioGroupProps`, `RoleViewOption`, `TabType`, `BadgeOrigin`, `ComponentOption`, `CarouselApi`, plus all the `GenericTable` types listed above.

`IRoute` (sidebar / waffle routes) = required `id`, `name`, `icon`, `path`, `agenda`; optional `isActive`, `roles`. `icon` is a **rendered node** — pass `<MyIcon />` or a string, not a component reference. There is no `subRoutes`. (`isActive`/`roles` became optional in 0.5.0; `icon` was retyped to `ReactNode`.)
