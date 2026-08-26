using FastEndpoints;
using Itixo.ComponentLibrary.Domain;
using Itixo.ComponentLibrary.Helpers;
using YourApp.Categories;
using Microsoft.EntityFrameworkCore;

namespace YourApp.Categories.ListCategories;

/// <summary>
/// Lists <see cref="Category"/> rows through the Itixo.ComponentLibrary.Tables filter,
/// search and sort pipeline. Page/PageSize bind from the query string; Query/Search/
/// OrderBy/OrderDirection bind from the JSON body, per <see cref="TableRequest"/>.
/// </summary>
// AppDbContext is your own DbContext — substitute your actual type
public sealed class CategoriesListEndpoint(AppDbContext db) : Endpoint<TableRequest, TableResponse<CategoryDto>>
{
    public override void Configure()
    {
        Post("list");
        Group<CategoriesGroup>();
        AllowAnonymous();
        Summary(s =>
        {
            s.Summary = "List categories with paging, filtering, searching and sorting.";
            s.Description = "Demonstrates the Itixo.ComponentLibrary.Tables pipeline on a collection-filter " +
                "column (RelatedProductIds): TableFilterGenerator builds scalar and collection filters plus " +
                "free-text search from TableRequest.Query/Search, TableSortExtensions applies the requested " +
                "sort, then the result is paged into a TableResponse<CategoryDto>.";
            s.Responses[StatusCodes.Status200OK] = "A page of categories matching the filter/search criteria, " +
                "with the total row count and column headers for building a UI table.";
        });
    }

    public override async Task HandleAsync(TableRequest req, CancellationToken ct)
    {
        var filters = TableFilterGenerator.BuildFilters(req.Query, TableDefinition.Filters);

        var searchFilter = TableFilterGenerator.BuildSearchFilters(req.Search, TableDefinition.Searches);
        if (searchFilter != null)
        {
            filters.Add(searchFilter);
        }

        var filtered = filters.Count > 0
            ? db.Categories.Where(FilterExpressionBuilder.CombineWithAnd(filters.ToArray()))
            : db.Categories.AsQueryable();

        filtered = filtered.ApplySort(req, TableDefinition.Columns);

        var totalCount = await filtered.CountAsync(ct);

        var page = req.Page <= 0 ? 1 : req.Page;
        var pageSize = req.PageSize <= 0 ? 10 : req.PageSize;

        var entities = await filtered
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(ct);

        var data = entities
            .Select(c => new CategoryDto(c.Id, c.Name, c.IsFeatured, c.RelatedProductIds, c.UpdatedAt))
            .ToList();

        var headers = TableDefinition.Columns.Select(c => c.ToHeader()).ToList();

        await Send.OkAsync(new TableResponse<CategoryDto>(page, pageSize, totalCount, headers, data), ct);
    }
}
