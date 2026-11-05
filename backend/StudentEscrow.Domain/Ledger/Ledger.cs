namespace StudentEscrow.Domain.Ledger;

public static class LedgerEntryType
{
    public const string AdminCredit = "AdminCredit";
    public const string GatewayDeposit = "GatewayDeposit";
    public const string EscrowHold = "EscrowHold";
    public const string EscrowHoldRelease = "EscrowHoldRelease";
    public const string EscrowPayout = "EscrowPayout";
    public const string EscrowRefund = "EscrowRefund";
    public const string ChainReversal = "ChainReversal";
}

// Spendable funds. Only LedgerService changes the balance, always together with a LedgerEntry.
public sealed class LedgerAccount
{
    private LedgerAccount() { }

    public LedgerAccount(Guid userId, DateTimeOffset updatedAt)
    {
        UserId = userId;
        UpdatedAt = updatedAt;
    }

    public Guid UserId { get; private set; }
    public decimal BalanceWei { get; private set; }
    public DateTimeOffset UpdatedAt { get; private set; }

    public void Apply(decimal amountWei, DateTimeOffset now)
    {
        BalanceWei += amountWei;
        UpdatedAt = now;
    }
}

public sealed class LedgerEntry
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string Type { get; set; } = string.Empty;
    public decimal AmountWei { get; set; }
    public decimal BalanceAfterWei { get; set; }
    public string IdempotencyKey { get; set; } = string.Empty;
    public Guid? DeploymentId { get; set; }
    public string? OrderId { get; set; }
    public string? TransactionHash { get; set; }
    public long? BlockNumber { get; set; }
    public Guid? ActorUserId { get; set; }
    public string? Note { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? ReversedAt { get; set; }
}
