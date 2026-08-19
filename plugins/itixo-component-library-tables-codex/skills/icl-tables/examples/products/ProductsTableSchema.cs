using Itixo.ComponentLibrary.Domain;
using Itixo.ComponentLibrary.Helpers;

namespace YourApp.Products;

/// <summary>
/// Registers filter, search, sort and display columns for <see cref="Product"/>.
/// Shared by <c>ProductsListEndpoint</c> and <c>ExportProductsTableCommand</c>.
/// </summary>
public static class ProductsTableSchema
{
    private const string NameField = "name";
    private const string TagsField = "tags";
    private const string PriceField = "price";

    public static readonly List<TableColumn<ProductDto, Product>> Columns =
    [
        new TableColumn<ProductDto, Product>(
            "Name",
            NameField,
            dto => dto.Name,
            TableFilterTypes.Text,
            FilterColumn: TableFilterGenerator.CreateColumn<Product, string>(NameField, p => p.Name),
            SearchColumn: TableFilterGenerator.CreateSearchColumn<Product>(p => p.Name),
            SortColumn: TableFilterGenerator.CreateSortColumn<Product, string>(NameField, p => p.Name)),
        new TableColumn<ProductDto, Product>(
            "Price",
            PriceField,
            dto => dto.Price,
            TableFilterTypes.Decimal,
            SortColumn: TableFilterGenerator.CreateSortColumn<Product, decimal>(PriceField, p => p.Price)),
        new TableColumn<ProductDto, Product>(
            "Tags",
            TagsField,
            dto => dto.Tags,
            TableFilterTypes.Select,
            FilterColumn: TableFilterGenerator.CreateColumn<Product, List<string>>(TagsField, p => p.Tags))
    ];

    public static readonly List<TableHeader> Headers = Columns
        .Where(c => c.IsVisibleInTable)
        .Select(c => c.ToHeader())
        .ToList();

    public static readonly List<DownloadebleDto> DownloadableColumns = Columns
        .Select(c => c.ToDownloadeble())
        .ToList();

    public static readonly List<TableFilterColumn<Product>> Filters = Columns
        .Where(c => c.FilterColumn != null)
        .Select(c => c.FilterColumn!)
        .ToList();

    public static readonly List<TableSearchColumn<Product>> Searches = Columns
        .Where(c => c.SearchColumn != null)
        .Select(c => c.SearchColumn!)
        .ToList();
}
