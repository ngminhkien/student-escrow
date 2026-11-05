namespace StudentEscrow.Domain.Wallets;

public sealed class WalletLink
{
    private WalletLink() { }

    public WalletLink(Guid id, Guid userId, string address, long chainId, DateTimeOffset linkedAt, bool isCustodial = false)
    {
        Id = id;
        UserId = userId;
        Address = address;
        ChainId = chainId;
        LinkedAt = linkedAt;
        IsCustodial = isCustodial;
    }

    public Guid Id { get; private set; }
    public Guid UserId { get; private set; }
    public string Address { get; private set; } = string.Empty;
    public long ChainId { get; private set; }
    public DateTimeOffset LinkedAt { get; private set; }
    public bool IsCustodial { get; private set; }

    public void MarkCustodial() => IsCustodial = true;
}
