using Itixo.ComponentLibrary.Domain;
using Itixo.ComponentLibrary.Helpers;
using YourApp.Orders;

namespace YourApp.Orders.ListOrders;

/// <summary>
/// Registers filter, search, sort and display columns for <see cref="Order"/>.
/// Used only by the <c>/api/orders/list</c> Minimal API handler.
/// </summary>
public static class TableDefinition
{
    private const string StatusField = "status";
    private const string LabelsField = "labels";
    private const string PlacedAtField = "placedAt";

    public static readonly List<TableColumn<OrderDto, Order>> Columns =
    [
        new TableColumn<OrderDto, Order>(
            "Customer",
            "customerName",
            dto => dto.CustomerName,
            TableFilterTypes.Text,
            SearchColumn: TableFilterGenerator.CreateSearchColumn<Order>(o => o.CustomerName)),
        new TableColumn<OrderDto, Order>(
            "Status",
            StatusField,
            dto => dto.Status,
            TableFilterTypes.Select,
            FilterColumn: TableFilterGenerator.CreateColumn<Order, string>(StatusField, o => o.Status)),
        new TableColumn<OrderDto, Order>(
            "Labels",
            LabelsField,
            dto => dto.Labels,
            TableFilterTypes.Select,
            FilterColumn: TableFilterGenerator.CreateColumn<Order, List<string>>(LabelsField, o => o.Labels)),
        new TableColumn<OrderDto, Order>(
            "Placed At",
            PlacedAtField,
            dto => dto.PlacedAt,
            TableFilterTypes.DateTimeSelect,
            SortColumn: TableFilterGenerator.CreateSortColumn<Order, DateTime>(PlacedAtField, o => o.PlacedAt))
    ];

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
