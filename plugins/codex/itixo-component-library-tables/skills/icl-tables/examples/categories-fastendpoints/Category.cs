namespace YourApp.Categories;

public sealed class Category
{
    public int Id { get; set; }

    public string Name { get; set; } = string.Empty;

    public bool IsFeatured { get; set; }

    public List<int> RelatedProductIds { get; set; } = [];

    public DateTime UpdatedAt { get; set; }
}
