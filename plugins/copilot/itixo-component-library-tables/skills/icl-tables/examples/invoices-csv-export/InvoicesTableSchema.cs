using Itixo.ComponentLibrary.Domain;
using Itixo.ComponentLibrary.Helpers;

namespace YourApp.Invoices;

/// <summary>
/// Registers filter, search, sort and display columns for <see cref="Invoice"/>.
/// Shared by <c>ListInvoices.Endpoint</c> and <c>ExportInvoicesTableCommand</c>.
/// </summary>
public static class InvoicesTableSchema
{
    private const string StatusField = "status";
    private const string TagsField = "tags";
    private const string IssuedAtField = "issuedAt";
    private const string AmountField = "amount";

    public static readonly List<TableColumn<InvoiceDto, Invoice>> Columns =
    [
        new TableColumn<InvoiceDto, Invoice>(
            "Customer",
            "customerName",
            dto => dto.CustomerName,
            TableFilterTypes.Text,
            SearchColumn: TableFilterGenerator.CreateSearchColumn<Invoice>(i => i.CustomerName)),
        new TableColumn<InvoiceDto, Invoice>(
            "Amount",
            AmountField,
            dto => dto.Amount,
            TableFilterTypes.Decimal,
            SortColumn: TableFilterGenerator.CreateSortColumn<Invoice, decimal>(AmountField, i => i.Amount)),
        new TableColumn<InvoiceDto, Invoice>(
            "Status",
            StatusField,
            dto => dto.Status,
            TableFilterTypes.Select,
            FilterColumn: TableFilterGenerator.CreateColumn<Invoice, string>(StatusField, i => i.Status)),
        new TableColumn<InvoiceDto, Invoice>(
            "Tags",
            TagsField,
            dto => dto.Tags,
            TableFilterTypes.Select,
            FilterColumn: TableFilterGenerator.CreateColumn<Invoice, List<string>>(TagsField, i => i.Tags)),
        new TableColumn<InvoiceDto, Invoice>(
            "Issued At",
            IssuedAtField,
            dto => dto.IssuedAt,
            TableFilterTypes.DateTimeSelect,
            SortColumn: TableFilterGenerator.CreateSortColumn<Invoice, DateTime>(IssuedAtField, i => i.IssuedAt))
    ];

    public static readonly List<TableHeader> Headers = Columns
        .Where(c => c.IsVisibleInTable)
        .Select(c => c.ToHeader())
        .ToList();

    public static readonly List<DownloadebleDto> DownloadableColumns = Columns
        .Select(c => c.ToDownloadeble())
        .ToList();

    public static readonly List<TableFilterColumn<Invoice>> Filters = Columns
        .Where(c => c.FilterColumn != null)
        .Select(c => c.FilterColumn!)
        .ToList();

    public static readonly List<TableSearchColumn<Invoice>> Searches = Columns
        .Where(c => c.SearchColumn != null)
        .Select(c => c.SearchColumn!)
        .ToList();
}
