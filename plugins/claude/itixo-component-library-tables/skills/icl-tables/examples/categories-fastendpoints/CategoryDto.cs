namespace YourApp.Categories;

public sealed record CategoryDto(
    int Id,
    string Name,
    bool IsFeatured,
    List<int> RelatedProductIds,
    DateTime UpdatedAt);
