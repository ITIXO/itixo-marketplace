namespace YourApp.Orders;

public sealed class Order
{
    public int Id { get; set; }

    public string CustomerName { get; set; } = string.Empty;

    public string Status { get; set; } = string.Empty;

    public List<string> Labels { get; set; } = [];

    public DateTime PlacedAt { get; set; }
}
