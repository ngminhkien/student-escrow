namespace StudentEscrow.Domain.Wallets;

// The server signs for this wallet. The key is stored only as ciphertext bound to this user and address.
public sealed class CustodialWallet
{
    public const string Generated = "Generated";
    public const string HardhatImport = "HardhatImport";

    private CustodialWallet() { }

    public CustodialWallet(Guid userId, string address, byte[] encryptedPrivateKey, string source, DateTimeOffset createdAt)
    {
        UserId = userId;
        Address = address;
        EncryptedPrivateKey = encryptedPrivateKey;
        Source = source;
        CreatedAt = createdAt;
    }

    public Guid UserId { get; private set; }
    public string Address { get; private set; } = string.Empty;
    public byte[] EncryptedPrivateKey { get; private set; } = [];
    public string Source { get; private set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; private set; }
}
