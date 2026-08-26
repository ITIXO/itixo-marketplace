namespace YourApp.Invoices;

public sealed class Invoice
{
    public int Id { get; set; }

    public string InvoiceNumber { get; set; } = string.Empty;

    public string CustomerName { get; set; } = string.Empty;

    public decimal Amount { get; set; }

    public string Status { get; set; } = string.Empty;

    public List<string> Tags { get; set; } = [];

    public DateTime IssuedAt { get; set; }

    public DateTime DueAt { get; set; }
}
