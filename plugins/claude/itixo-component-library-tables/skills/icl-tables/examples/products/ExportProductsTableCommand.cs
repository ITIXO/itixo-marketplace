using FastEndpoints;
using Itixo.ComponentLibrary.Domain;
using Itixo.ComponentLibrary.Helpers;
using Microsoft.EntityFrameworkCore;

namespace YourApp.Products.Commands.Export;

/// <summary>
/// Streams every filtered/searched/sorted <see cref="Product"/> row as CSV, without
/// pagination, using the same <see cref="ProductsTableSchema"/> as <c>ProductsListEndpoint</c>.
/// </summary>
// AppDbContext is your own DbContext — substitute your actual type
public sealed class ExportProductsTableCommand(AppDbContext db) : Endpoint<TableRequest>
{
    public override void Configure()
    {
        Post("export");
        Group<ProductsGroup>();
        AllowAnonymous();
        Summary(s =>
        {
            s.Summary = "Export the filtered/searched/sorted product list as CSV.";
            s.Description = "Runs the same TableFilterGenerator/TableSortExtensions pipeline as the list " +
                "endpoint, but skips paging and streams every matching row through TableExporter.GenerateCsv, " +
                "using the ProductsTableSchema column list to pick the exported columns.";
            s.Responses[StatusCodes.Status200OK] = "A streamed products.csv file containing every product " +
                "matching the filter/search criteria.";
        });
    }

    public override async Task HandleAsync(TableRequest req, CancellationToken ct)
    {
        var filters = TableFilterGenerator.BuildFilters(req.Query, ProductsTableSchema.Filters);

        var searchFilter = TableFilterGenerator.BuildSearchFilters(req.Search, ProductsTableSchema.Searches);
        if (searchFilter != null)
        {
            filters.Add(searchFilter);
        }

        var filtered = filters.Count > 0
            ? db.Products.Where(FilterExpressionBuilder.CombineWithAnd(filters.ToArray()))
            : db.Products.AsQueryable();

        filtered = filtered.ApplySort(req, ProductsTableSchema.Columns);

        var entities = await filtered.ToListAsync(ct);

        var data = entities
            .Select(p => new ProductDto(p.Id, p.Name, p.Price, p.IsActive, p.Tags, p.CreatedAt))
            .ToList();

        var csv = TableExporter.GenerateCsv(data, ProductsTableSchema.Columns);

        await Send.StreamAsync(csv, "products.csv", contentType: "text/csv", cancellation: ct);
    }
}
