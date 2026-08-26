namespace YourApp.Invoices;

public sealed record InvoiceDto(
    int Id,
    string InvoiceNumber,
    string CustomerName,
    decimal Amount,
    string Status,
    List<string> Tags,
    DateTime IssuedAt,
    DateTime DueAt);
