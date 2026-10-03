namespace StudentEscrow.Domain.Wallets;

public sealed class WalletChallenge
{
    private WalletChallenge() { }

    public WalletChallenge(Guid id, Guid userId, string address, long chainId, string nonce,
        string message, DateTimeOffset issuedAt, DateTimeOffset expiresAt)
    {
        Id = id;
        UserId = userId;
        Address = address;
        ChainId = chainId;
        Nonce = nonce;
        Message = message;
        IssuedAt = issuedAt;
        ExpiresAt = expiresAt;
    }

    public Guid Id { get; private set; }
    public Guid UserId { get; private set; }
    public string Address { get; private set; } = string.Empty;
    public long ChainId { get; private set; }
    public string Nonce { get; private set; } = string.Empty;
    public string Message { get; private set; } = string.Empty;
    public DateTimeOffset IssuedAt { get; private set; }
    public DateTimeOffset ExpiresAt { get; private set; }
    public DateTimeOffset? UsedAt { get; private set; }
}
