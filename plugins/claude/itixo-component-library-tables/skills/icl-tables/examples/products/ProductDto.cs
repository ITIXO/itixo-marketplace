namespace YourApp.Products;

public sealed record ProductDto(
    int Id,
    string Name,
    decimal Price,
    bool IsActive,
    List<string> Tags,
    DateTime CreatedAt);
