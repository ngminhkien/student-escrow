namespace StudentEscrow.Domain.Ledger;

public static class DepositStatus
{
    public const string Pending = "Pending";
    public const string Succeeded = "Succeeded";
    public const string Failed = "Failed";
    public const string Cancelled = "Cancelled";
    public const string Expired = "Expired";
}

// The ETH a paid deposit sends to the user's wallet. A self-held wallet has nothing else; a custodial one also gets a ledger balance.
public static class DepositPayoutStatus
{
    public const string Queued = "Queued";
    // Set before broadcasting. A row left here may or may not have paid, so nothing resends it automatically.
    public const string Sending = "Sending";
    public const string Sent = "Sent";
}

// A request to add money through a payment gateway. It holds no balance: only the ledger entry or on-chain payout made on success does.
public sealed class DepositRequest
{
    private DepositRequest() { }

    public DepositRequest(Guid id, Guid userId, long amountVnd, Guid reference, string gateway, DateTimeOffset createdAt, DateTimeOffset expiresAt, string? payoutAddress = null, bool creditsLedger = true)
    {
        Id = id;
        UserId = userId;
        AmountVnd = amountVnd;
        Reference = reference;
        Gateway = gateway;
        Status = DepositStatus.Pending;
        CreatedAt = createdAt;
        ExpiresAt = expiresAt;
        PayoutAddress = payoutAddress;
        CreditsLedger = creditsLedger;
    }

    public Guid Id { get; private set; }
    public Guid UserId { get; private set; }
    public long AmountVnd { get; private set; }
    public Guid Reference { get; private set; }
    public string Gateway { get; private set; } = string.Empty;
    public string Status { get; private set; } = string.Empty;
    public string? GatewayTransactionId { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset ExpiresAt { get; private set; }
    public DateTimeOffset? CompletedAt { get; private set; }
    public bool CreditsLedger { get; private set; } = true;
    public string? PayoutAddress { get; private set; }
    public string? PayoutStatus { get; private set; }
    public string? PayoutTransactionHash { get; private set; }

    // A Pending row past its deadline stays Pending in SQL until something touches it, so readers ask this instead.
    public string StatusAt(DateTimeOffset now) => Status == DepositStatus.Pending && now > ExpiresAt ? DepositStatus.Expired : Status;

    public void Complete(string status, string? gatewayTransactionId, DateTimeOffset now)
    {
        if (Status != DepositStatus.Pending) throw new InvalidOperationException("A finished deposit cannot change.");
        Status = status;
        GatewayTransactionId = gatewayTransactionId;
        CompletedAt = now;
        if (status == DepositStatus.Succeeded && PayoutAddress is not null) PayoutStatus = DepositPayoutStatus.Queued;
    }
}
