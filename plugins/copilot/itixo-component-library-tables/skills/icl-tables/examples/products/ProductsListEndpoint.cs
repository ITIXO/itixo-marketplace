using FastEndpoints;
using Itixo.ComponentLibrary.Domain;
using Itixo.ComponentLibrary.Helpers;
using Microsoft.EntityFrameworkCore;

namespace YourApp.Products;

/// <summary>
/// Lists <see cref="Product"/> rows through the Itixo.ComponentLibrary.Tables filter,
/// search and sort pipeline. Page/PageSize bind from the query string; Query/Search/
/// OrderBy/OrderDirection bind from the JSON body, per <see cref="TableRequest"/>.
/// </summary>
// AppDbContext is your own DbContext — substitute your actual type
public sealed class ProductsListEndpoint(AppDbContext db) : Endpoint<TableRequest, TableResponse<ProductDto>>
{
    public override void Configure()
    {
        Post("list");
        Group<ProductsGroup>();
        AllowAnonymous();
        Summary(s =>
        {
            s.Summary = "List products with paging, filtering, searching and sorting.";
            s.Description = "Demonstrates the Itixo.ComponentLibrary.Tables pipeline: TableFilterGenerator " +
                "builds scalar and collection filters plus free-text search from TableRequest.Query/Search, " +
                "TableSortExtensions applies the requested OrderBy/OrderDirection, then the result is paged " +
                "into a TableResponse<ProductDto>.";
            s.Responses[StatusCodes.Status200OK] = "A page of products matching the filter/search criteria, " +
                "with the total row count and column headers for building a UI table.";
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

        var totalCount = await filtered.CountAsync(ct);

        var page = req.Page <= 0 ? 1 : req.Page;
        var pageSize = req.PageSize <= 0 ? 10 : req.PageSize;

        var entities = await filtered
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(ct);

        var data = entities
            .Select(p => new ProductDto(p.Id, p.Name, p.Price, p.IsActive, p.Tags, p.CreatedAt))
            .ToList();

        var headers = ProductsTableSchema.Columns.Select(c => c.ToHeader()).ToList();

        await Send.OkAsync(new TableResponse<ProductDto>(page, pageSize, totalCount, headers, data), ct);
    }
}
