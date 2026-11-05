using System.ComponentModel.DataAnnotations;

namespace StudentEscrow.Application.Wallets;

public static class DepositLimits
{
    // frontend/src/domain/money.ts repeats these for the form; the server's check is the one that counts.
    public const long MinVnd = 10_000;
    public const long MaxVnd = 50_000_000;
    public const int MaxOpenRequests = 5;
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(15);
}

public sealed class CreateDepositRequest
{
    public long AmountVnd { get; init; }
    public Guid Reference { get; init; }
}

public sealed class MockPaymentRequest
{
    [Required, RegularExpression("^(Succeeded|Failed)$")]
    public string Outcome { get; init; } = string.Empty;
}

// The body a gateway posts back. Timestamp is Unix seconds and is covered by the signature.
public sealed class PaymentWebhookRequest
{
    public Guid DepositId { get; init; }
    public long AmountVnd { get; init; }
    [Required, RegularExpression("^(Succeeded|Failed)$")]
    public string Status { get; init; } = string.Empty;
    [Required, RegularExpression("^[A-Za-z0-9_-]{1,64}$")]
    public string GatewayTransactionId { get; init; } = string.Empty;
    public long Timestamp { get; init; }
    [Required, RegularExpression("^[0-9a-f]{64}$")]
    public string Signature { get; init; } = string.Empty;
}

public sealed record DepositResponse(Guid Id, long AmountVnd, string AmountWei, string Status, string Gateway, string? GatewayTransactionId,
    DateTimeOffset CreatedAt, DateTimeOffset ExpiresAt, DateTimeOffset? CompletedAt,
    string? PayoutAddress = null, string? PayoutStatus = null, string? PayoutTransactionHash = null);

public sealed record PaymentWebhookResponse(string Status);
