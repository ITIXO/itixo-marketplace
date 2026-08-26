using Itixo.ComponentLibrary.Domain;
using Itixo.ComponentLibrary.Helpers;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace YourApp.Invoices.ListInvoices;

/// <summary>
/// Maps the <c>/list</c> Minimal API endpoint onto the "invoices" route group,
/// exercising the same Itixo.ComponentLibrary.Tables filter, search and sort pipeline
/// as the FastEndpoints-based Products/Categories list endpoints.
/// </summary>
public static class Endpoint
{
    public static void MapListInvoicesEndpoint(this IEndpointRouteBuilder app)
    {
        // AppDbContext is your own DbContext — substitute your actual type
        app.MapPost("/list", async ([FromBody] TableRequest request, AppDbContext db, CancellationToken ct) =>
        {
            var filters = TableFilterGenerator.BuildFilters(request.Query, InvoicesTableSchema.Filters);

            var searchFilter = TableFilterGenerator.BuildSearchFilters(request.Search, InvoicesTableSchema.Searches);
            if (searchFilter != null)
            {
                filters.Add(searchFilter);
            }

            var filtered = filters.Count > 0
                ? db.Invoices.Where(FilterExpressionBuilder.CombineWithAnd(filters.ToArray()))
                : db.Invoices.AsQueryable();

            filtered = filtered.ApplySort(request, InvoicesTableSchema.Columns);

            var totalCount = await filtered.CountAsync(ct);

            var page = request.Page <= 0 ? 1 : request.Page;
            var pageSize = request.PageSize <= 0 ? 10 : request.PageSize;

            var entities = await filtered
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .ToListAsync(ct);

            var data = entities
                .Select(i => new InvoiceDto(i.Id, i.InvoiceNumber, i.CustomerName, i.Amount, i.Status, i.Tags, i.IssuedAt, i.DueAt))
                .ToList();

            var headers = InvoicesTableSchema.Columns.Select(c => c.ToHeader()).ToList();

            return Results.Ok(new TableResponse<InvoiceDto>(page, pageSize, totalCount, headers, data));
        })
        .WithSummary("List invoices with paging, filtering, searching and sorting.")
        .WithDescription("Demonstrates the Itixo.ComponentLibrary.Tables pipeline on a Minimal API endpoint: " +
            "TableFilterGenerator builds scalar and collection filters plus free-text search from " +
            "TableRequest.Query/Search, TableSortExtensions applies the requested sort, then the result is " +
            "paged into a TableResponse<InvoiceDto>.");
    }
}
