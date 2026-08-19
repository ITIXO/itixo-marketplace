---
name: icl-tables
description: Build server-side paginated/filterable/sortable/searchable table endpoints and CSV export using the Itixo.ComponentLibrary.Tables NuGet package (namespace Itixo.ComponentLibrary). Use this skill whenever the user asks to add a "list" or "table" endpoint backed by Entity Framework Core, wants generic filter/search/sort/export support for a DTO+entity pair, mentions TableRequest, TableResponse, TableColumn, TableFilterGenerator, FilterExpressionBuilder, ApplySort, or TableExporter, or wants to wire up a new resource (e.g. Products, Orders, Invoices, Categories) with query-string pagination, JSON filter bodies, free-text search, column-based sorting, or CSV export — whether working inside the Itixo.ComponentLibrary.Tables package repo itself or in any consumer project that references the Itixo.ComponentLibrary.Tables package. Even if the user just says "add a list endpoint for X with filtering and sorting" without naming the package, check whether the project already references Itixo.ComponentLibrary.Tables and use this skill if it does.
---

# Itixo.ComponentLibrary.Tables usage

This package gives a generic, EF-Core-translatable pipeline for list endpoints: pagination, per-column filtering, free-text search, sorting, and CSV export. It never materializes data before it has to — every filter/search/sort step builds an `Expression<Func<TEntity, bool>>` or an `IQueryable` transform, so EF Core can push the whole thing to SQL.

This skill bundles reference implementations under `examples/` (relative to this SKILL.md) — read the matching example folder before writing new code, the shapes rarely need to change:

| Folder | Demonstrates |
|---|---|
| `examples/categories-fastendpoints/` | FastEndpoints handler, scalar + collection filter, free-text search, sort |
| `examples/orders-minimalapi/` | Minimal API handler, scalar + collection filter, free-text search, sort |
| `examples/invoices-csv-export/` | CSV export endpoint (Minimal API), same pipeline minus pagination |
| `examples/products/` | Both a list endpoint and a CSV export endpoint for one resource |

## Mental model

For one resource (e.g. `Order` entity + `OrderDto`) you write two things:

1. A **table schema** (a static class, e.g. `TableDefinition.cs` or `<Resource>TableSchema.cs`) that declares one `Columns` list mixing display, filter, search, and sort metadata per column, plus a few properties derived from that one list.
2. An **endpoint** (FastEndpoints handler or Minimal API route) that takes a `TableRequest`, runs the fixed pipeline against `DbContext`, and returns a `TableResponse<TDto>`.

Do not hand-roll filter/sort/pagination logic outside this pipeline — the package exists so every resource follows the same shape.

## Building blocks (namespace `Itixo.ComponentLibrary.Domain` / `Itixo.ComponentLibrary.Helpers`)

| Type | Role |
|---|---|
| `TableRequest` | Incoming request: `Page`, `PageSize` (`[QueryParam]`), `Query` (dict of column key to raw JSON filter), `Search` (list of terms), `OrderBy`, `OrderDirection` |
| `TableResponse<TDto>` | Outgoing response: `Page`, `PageSize`, `TotalCount`, `Headers` (`List<TableHeader>`), `Data` (`List<TDto>`), optional `DownloadebleData` |
| `TableColumn<TDto, TEntity>` | One column, all metadata in one place: `Header`, `Key`, DTO `Selector`, `FilterType` (drives frontend control), `FilterOptions`, `IsVisibleInTable` (default true), `IsEditable`, optional `FilterColumn`, `SearchColumn`, `SortColumn`, `Align` |
| `TableColumn.ToHeader()` | Projects a column to a `TableHeader` (for the response's `Headers` list) |
| `TableColumn.ToDownloadeble()` | Projects a column to a `DownloadebleDto` (export column metadata) |
| `TableFilterColumn<TEntity>` | Key + `Func<string, Expression<Func<TEntity,bool>>?>` — built by `TableFilterGenerator.CreateColumn` |
| `TableSearchColumn<TEntity>` | `Func<List<string>, Expression<Func<TEntity,bool>>?>` — built by `TableFilterGenerator.CreateSearchColumn` / `CreateCollectionSearchColumn` |
| `TableSortColumn<TEntity>` | Key + ascending/descending `Func<IQueryable<TEntity>,IQueryable<TEntity>>` — built by `TableFilterGenerator.CreateSortColumn` |
| `TableFilterTypes` | Frontend control hint: `Text`, `Number`, `Decimal`, `Select`, `MultiSelect`, `Check`, `DateTimeSelect`, `None` |
| `FilterOperand` | `Is`, `IsNot`, `Contains`, `DoesNotContain`, `StartsWith`, `EndsWith`, `GreaterThan`, `LessThan`, `GreaterThanOrEqual`, `LessThanOrEqual` |
| `TableFilterGenerator` | Static factory/orchestration: `CreateColumn(key, selector, useAnd = false)`, `CreateSearchColumn`, `CreateCollectionSearchColumn`, `CreateSortColumn`, `BuildFilters`, `BuildSearchFilters` |
| `FilterExpressionBuilder` | Static expression-tree helpers: `BuildFilter`, `BuildCollectionFilter`, `BuildSearchFilter`, `BuildCollectionSearchFilter`, `CombineWithAnd`, `CombineWithOr` |
| `TableSortExtensions.ApplySort<TDto,TEntity>` | `IQueryable<TEntity>` extension; matches `TableRequest.OrderBy` to a registered `TableSortColumn.Key`, applies it, returns query unchanged if no match |
| `TableExporter.GenerateCsv` | Two overloads: column-driven (uses `TableColumn` selectors) and reflection-driven (all public properties) |

`TableFilterGenerator.CreateColumn<TEntity, TFilter>` auto-detects whether `TFilter` is a scalar or a collection (e.g. `List<int>`, `List<string>`) and builds the right kind of filter:
- **Scalar column**: supports the full `FilterOperand` set (`Is`, `Contains`, `GreaterThan`, ...). Pass `useAnd: true` only if the field should require every matching filter value to hold simultaneously instead of any — most columns leave this at its default `false`.
- **Collection column**: supports only `Contains` / `DoesNotContain`, translated to `Enumerable.Contains` over the collection property.

## The table schema pattern

Every schema class follows this exact shape — one `Columns` list is the single source of truth, everything else is derived from it. See `examples/categories-fastendpoints/TableDefinition.cs` for a complete real file.

```csharp
public static class TableDefinition
{
    // One private const per column key that is referenced more than once in this file
    // (in a TableColumn entry's key argument AND in a CreateColumn/CreateSortColumn call).
    // A key used only once can stay a literal.
    private const string StatusField = "status";
    private const string LabelsField = "labels";
    private const string PlacedAtField = "placedAt";

    public static readonly List<TableColumn<OrderDto, Order>> Columns =
    [
        new("Customer", "customerName", dto => dto.CustomerName,
            TableFilterTypes.Text,
            SearchColumn: TableFilterGenerator.CreateSearchColumn<Order>(o => o.CustomerName)),
        new("Status", StatusField, dto => dto.Status,
            TableFilterTypes.Select,
            FilterColumn: TableFilterGenerator.CreateColumn<Order, string>(StatusField, o => o.Status)),
        new("Labels", LabelsField, dto => dto.Labels,
            TableFilterTypes.MultiSelect,
            // Collection property -> collection filter is auto-detected
            FilterColumn: TableFilterGenerator.CreateColumn<Order, List<string>>(LabelsField, o => o.Labels)),
        new("Placed At", PlacedAtField, dto => dto.PlacedAt,
            TableFilterTypes.DateTimeSelect,
            SortColumn: TableFilterGenerator.CreateSortColumn<Order, DateTime>(PlacedAtField, o => o.PlacedAt)),
    ];

    // Derived from Columns — do not hand-maintain these as separate lists.
    public static readonly List<TableHeader> Headers = Columns
        .Where(c => c.IsVisibleInTable)
        .Select(c => c.ToHeader())
        .ToList();

    public static readonly List<DownloadebleDto> DownloadableColumns = Columns
        .Select(c => c.ToDownloadeble())
        .ToList();

    public static readonly List<TableFilterColumn<Order>> Filters = Columns
        .Where(c => c.FilterColumn != null)
        .Select(c => c.FilterColumn!)
        .ToList();

    public static readonly List<TableSearchColumn<Order>> Searches = Columns
        .Where(c => c.SearchColumn != null)
        .Select(c => c.SearchColumn!)
        .ToList();
}
```

Rules:
- Give every filterable/sortable column a stable `key` string — that key is what the frontend sends back in `TableRequest.Query` / `OrderBy`. Use the same const for that key everywhere it appears.
- Only extract a `private const string <Name>Field` for a key that is used more than once in the file. A key used exactly once can stay a literal — don't add a const nobody else reads.
- Build `FilterColumn`, `SearchColumn`, and `SortColumn` inline, directly as named arguments in the `Columns` entry — don't bind them to an intermediate private field first. `Columns` is the only place these get constructed.
- `Filters`, `Searches`, `Headers`, and `DownloadableColumns` are always derived from `Columns` via LINQ, never hand-written as their own list. This is what keeps the column list the single source of truth: add a filter to one `TableColumn` entry and it automatically shows up in `Filters` without a second edit.

## Step-by-step: add a new list endpoint for a resource

1. **Confirm the entity and DTO exist** (or create them) — entity for EF Core, DTO for the wire shape. See `examples/orders-minimalapi/Order.cs` and `OrderDto.cs`.
2. **Write the table schema** following the pattern above, next to the endpoint.
3. **Write the endpoint.** Two supported shapes, pick whichever matches the surrounding project convention:
   - **FastEndpoints** — see `examples/categories-fastendpoints/Endpoint.cs`. Handler extends `Endpoint<TableRequest, TableResponse<TDto>>`.
   - **Minimal API** — see `examples/orders-minimalapi/Endpoint.cs`. `app.MapPost("/list", async ([FromBody] TableRequest req, DbContext db, CancellationToken ct) => ...)`.

   Both follow the same fixed pipeline:
   ```csharp
   var filters = TableFilterGenerator.BuildFilters(req.Query, TableDefinition.Filters);
   var searchFilter = TableFilterGenerator.BuildSearchFilters(req.Search, TableDefinition.Searches);
   if (searchFilter is not null) filters.Add(searchFilter);
   var predicate = FilterExpressionBuilder.CombineWithAnd(filters.ToArray());

   var query = db.Set<Order>().Where(predicate);
   var totalCount = await query.CountAsync(ct);
   var data = await query
       .ApplySort(req, TableDefinition.Columns)
       .Skip((req.Page - 1) * req.PageSize)
       .Take(req.PageSize)
       .Select(/* project to OrderDto */)
       .ToListAsync(ct);

   return new TableResponse<OrderDto>(req.Page, req.PageSize, totalCount, TableDefinition.Headers, data);
   ```
   Count before pagination, apply sort before `Skip`/`Take`, project to the DTO inside or right after the query so EF Core can translate it. Use `TableDefinition.Headers` directly for the response rather than re-projecting `Columns` at the call site.
4. **CSV export (optional).** Only add this if the user asks for export/download. Mirror `examples/invoices-csv-export/ExportInvoicesTableCommand.cs`: run the identical filter/search/sort pipeline but skip pagination, then:
   ```csharp
   var csv = TableExporter.GenerateCsv(data, TableDefinition.Columns);
   return Results.Stream(csv, "text/csv", "orders.csv");
   ```
   CSV formatting is fixed by the package: UTF-8 BOM, `;` delimiter, Czech culture (`cs-CZ`), booleans as `Ano`/`Ne`, `DateTime` as `dd.MM.yyyy HH:mm`. Do not try to override this per-endpoint — if the user needs different formatting, flag it as a package-level change instead of a workaround in the endpoint.

## Gotchas

- **Sorting only works through a registered `TableSortColumn`.** `ApplySort` matches `TableRequest.OrderBy` against `TableColumn.SortColumn.Key` by exact (ordinal, case-sensitive) string match. If the key sent by the frontend does not exactly match what you registered, the query silently returns unsorted — this is not a bug, it is how the package is designed to fail safe. Using the same `private const string ...Field` everywhere a key appears is what prevents this class of typo.
- **`DownloadebleDto` and `TableResponse.DownloadebleData` are spelled that way on purpose.** It is a known typo baked into the public API. Do not "fix" the spelling — that is a breaking NuGet API change and out of scope unless the user explicitly asks for a package version bump.
- **Collection filters only support `Contains` / `DoesNotContain`.** If a user asks for `GreaterThan`/`StartsWith`/etc. on a `List<T>` property, that is not supported by `BuildCollectionFilter` — say so rather than trying to force it.
- **Pagination is the caller's job**, not the package's. `TableRequest.Page`/`PageSize` are just data — you still write the `Skip`/`Take` yourself in the endpoint.
- **This package is stateless and generic on purpose**: do not add app-specific entities, auth, or endpoint concerns into `Itixo.ComponentLibrary.Tables` itself. Endpoint/entity/DTO code belongs in the consuming project (or `Tables.Examples`); only cross-resource, reusable helpers belong in the package's `Domain/`/`Helpers/` folders.
- **A known `CS8620` nullable-mismatch warning exists in `TableFilterGenerator.CreateColumn`.** It is documented technical debt — do not suppress it and do not treat it as a new bug to fix unless asked.
- **`Filters`/`Searches`/`Headers`/`DownloadableColumns` must stay derived, never hand-duplicated, and their builders must stay inline in `Columns`.** If you see a schema class with intermediate private fields like `StatusFilter`/`NameSearch`, or a separate hand-maintained `FilterColumns`/`SearchColumns` list sitting next to `Columns`, that is the old pattern — inline the builder call into the `Columns` entry and use the derived properties instead.

## When editing the package itself (not just consuming it)

If the task is inside `src/Itixo.ComponentLibrary.Tables/` in the package's own repo (rather than a consumer project):
- Keep public API changes NuGet-breaking-change aware — this package is versioned and published (`Itixo.ComponentLibrary.Tables`) via GitHub Actions on `v*.*.*` tags.
- Keep helpers generic over `TEntity`/`TDto`/`TFilter` — no consumer-specific logic.
- Preserve expression-tree translatability (`Expression<Func<...>>`) — do not replace an expression tree with a compiled delegate, EF Core needs the tree to build SQL.
- One public type per file, PascalCase file name matching the type name, under `Domain/` (contracts/metadata) or `Helpers/` (stateless logic).

## Installing the package

Consuming this package from its private feed needs a `nuget.config` with package source mapping, not just the default `nuget.org` source. See `references/nuget-setup.md` for the exact config.
