using Itixo.ComponentLibrary.Domain;
using Itixo.ComponentLibrary.Helpers;
using YourApp.Orders;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace YourApp.Orders.ListOrders;

/// <summary>
/// Maps the <c>/list</c> Minimal API endpoint onto the "orders" route group, exercising
/// the same Itixo.ComponentLibrary.Tables filter, search and sort pipeline as the
/// FastEndpoints-based Products/Categories list endpoints.
/// </summary>
public static class Endpoint
{
    public static void MapListOrdersEndpoint(this IEndpointRouteBuilder app)
    {
        // AppDbContext is your own DbContext — substitute your actual type
        app.MapPost("/list", async ([FromBody] TableRequest request, AppDbContext db, CancellationToken ct) =>
        {
            var filters = TableFilterGenerator.BuildFilters(request.Query, TableDefinition.Filters);

            var searchFilter = TableFilterGenerator.BuildSearchFilters(request.Search, TableDefinition.Searches);
            if (searchFilter != null)
            {
                filters.Add(searchFilter);
            }

            var filtered = filters.Count > 0
                ? db.Orders.Where(FilterExpressionBuilder.CombineWithAnd(filters.ToArray()))
                : db.Orders.AsQueryable();

            filtered = filtered.ApplySort(request, TableDefinition.Columns);

            var totalCount = await filtered.CountAsync(ct);

            var page = request.Page <= 0 ? 1 : request.Page;
            var pageSize = request.PageSize <= 0 ? 10 : request.PageSize;

            var entities = await filtered
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .ToListAsync(ct);

            var data = entities
                .Select(o => new OrderDto(o.Id, o.CustomerName, o.Status, o.Labels, o.PlacedAt))
                .ToList();

            var headers = TableDefinition.Columns.Select(c => c.ToHeader()).ToList();

            return Results.Ok(new TableResponse<OrderDto>(page, pageSize, totalCount, headers, data));
        })
        .WithSummary("List orders with paging, filtering, searching and sorting.")
        .WithDescription("Demonstrates the Itixo.ComponentLibrary.Tables pipeline on a Minimal API endpoint: " +
            "TableFilterGenerator builds scalar and collection filters plus free-text search from " +
            "TableRequest.Query/Search, TableSortExtensions applies the requested sort, then the result is " +
            "paged into a TableResponse<OrderDto>.");
    }
}
