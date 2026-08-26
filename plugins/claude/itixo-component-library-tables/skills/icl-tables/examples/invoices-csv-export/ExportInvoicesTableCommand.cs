using Itixo.ComponentLibrary.Domain;
using Itixo.ComponentLibrary.Helpers;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace YourApp.Invoices.Commands.Export;

/// <summary>
/// Streams every filtered/searched/sorted <see cref="Invoice"/> row as CSV, without
/// pagination, using the same <see cref="InvoicesTableSchema"/> as
/// <c>ListInvoices.Endpoint</c>. Maps a Minimal API route onto the "invoices" route
/// group, unlike the FastEndpoints-based
/// <c>Products/Commands/Export/ExportProductsTableCommand</c>.
/// </summary>
public static class ExportInvoicesTableCommand
{
    public static void MapExportInvoicesEndpoint(this IEndpointRouteBuilder app)
    {
        // AppDbContext is your own DbContext — substitute your actual type
        app.MapPost("/export", async ([FromBody] TableRequest request, AppDbContext db, CancellationToken ct) =>
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

            var entities = await filtered.ToListAsync(ct);

            var data = entities
                .Select(i => new InvoiceDto(i.Id, i.InvoiceNumber, i.CustomerName, i.Amount, i.Status, i.Tags, i.IssuedAt, i.DueAt))
                .ToList();

            var csv = TableExporter.GenerateCsv(data, InvoicesTableSchema.Columns);

            return Results.Stream(csv, "text/csv", "invoices.csv");
        })
        .WithSummary("Export the filtered/searched/sorted invoice list as CSV.")
        .WithDescription("Runs the same TableFilterGenerator/TableSortExtensions pipeline as the list " +
            "endpoint, but skips paging and streams every matching row through TableExporter.GenerateCsv, " +
            "using the InvoicesTableSchema column list to pick the exported columns.");
    }
}
