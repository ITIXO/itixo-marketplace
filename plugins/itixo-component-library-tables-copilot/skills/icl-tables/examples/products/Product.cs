namespace YourApp.Products;

public sealed class Product
{
    public int Id { get; set; }

    public string Name { get; set; } = string.Empty;

    public decimal Price { get; set; }

    public bool IsActive { get; set; }

    public List<string> Tags { get; set; } = [];

    public DateTime CreatedAt { get; set; }
}
