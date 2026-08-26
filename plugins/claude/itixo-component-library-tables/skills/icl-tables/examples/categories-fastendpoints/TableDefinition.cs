using Itixo.ComponentLibrary.Domain;
using Itixo.ComponentLibrary.Helpers;
using YourApp.Categories;

namespace YourApp.Categories.ListCategories;

/// <summary>
/// Registers filter, search, sort and display columns for <see cref="Category"/>.
/// Used only by <see cref="CategoriesListEndpoint"/>.
/// </summary>
public static class TableDefinition
{
    private const string NameField = "name";
    private const string RelatedProductIdsField = "relatedProductIds";
    private const string UpdatedAtField = "updatedAt";

    public static readonly List<TableColumn<CategoryDto, Category>> Columns =
    [
        new TableColumn<CategoryDto, Category>(
            "Name",
            NameField,
            dto => dto.Name,
            TableFilterTypes.Text,
            FilterColumn: TableFilterGenerator.CreateColumn<Category, string>(NameField, c => c.Name),
            SearchColumn: TableFilterGenerator.CreateSearchColumn<Category>(c => c.Name),
            SortColumn: TableFilterGenerator.CreateSortColumn<Category, string>(NameField, c => c.Name)),
        new TableColumn<CategoryDto, Category>(
            "Related Products",
            RelatedProductIdsField,
            dto => dto.RelatedProductIds,
            TableFilterTypes.Select,
            FilterColumn: TableFilterGenerator.CreateColumn<Category, List<int>>(RelatedProductIdsField, c => c.RelatedProductIds)),
        new TableColumn<CategoryDto, Category>(
            "Updated At",
            UpdatedAtField,
            dto => dto.UpdatedAt,
            TableFilterTypes.DateTimeSelect,
            SortColumn: TableFilterGenerator.CreateSortColumn<Category, DateTime>(UpdatedAtField, c => c.UpdatedAt))
    ];

    public static readonly List<TableHeader> Headers = Columns
        .Where(c => c.IsVisibleInTable)
        .Select(c => c.ToHeader())
        .ToList();

    public static readonly List<DownloadebleDto> DownloadableColumns = Columns
        .Select(c => c.ToDownloadeble())
        .ToList();

    public static readonly List<TableFilterColumn<Category>> Filters = Columns
        .Where(c => c.FilterColumn != null)
        .Select(c => c.FilterColumn!)
        .ToList();

    public static readonly List<TableSearchColumn<Category>> Searches = Columns
        .Where(c => c.SearchColumn != null)
        .Select(c => c.SearchColumn!)
        .ToList();
}
