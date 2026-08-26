namespace YourApp.Orders;

public sealed record OrderDto(
    int Id,
    string CustomerName,
    string Status,
    List<string> Labels,
    DateTime PlacedAt);
