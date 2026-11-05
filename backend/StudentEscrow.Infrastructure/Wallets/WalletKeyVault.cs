using System.Security.Cryptography;
using System.Text;

namespace StudentEscrow.Infrastructure.Wallets;

public sealed class CustodialSettings
{
    public bool Enabled { get; set; }
    // Base64 of 32 random bytes. Takes precedence over MasterKeyFile.
    public string MasterKey { get; set; } = string.Empty;
    // Development only: created on first use. Losing this file makes every stored key unreadable.
    public string MasterKeyFile { get; set; } = "../../.runtime/custodial-master.key";
    // Takes over every account linked to a Hardhat wallet at startup, including ones meant to stay on MetaMask. Off unless a test needs it.
    public bool ImportHardhatWallets { get; set; }
}

// AES-256-GCM. Binding the ciphertext to user and address means a row swap in SQL fails to decrypt
// instead of letting one account sign with another account's key.
public sealed class WalletKeyVault
{
    private const byte Version = 1;
    private const int NonceSize = 12, TagSize = 16;
    private readonly byte[] masterKey;

    public WalletKeyVault(byte[] masterKey)
    {
        if (masterKey.Length != 32) throw new InvalidOperationException("The custodial master key must be exactly 32 bytes.");
        this.masterKey = masterKey;
    }

    public static WalletKeyVault Load(CustodialSettings settings, bool development)
    {
        if (!string.IsNullOrWhiteSpace(settings.MasterKey))
        {
            try { return new WalletKeyVault(Convert.FromBase64String(settings.MasterKey)); }
            catch (FormatException exception)
            { throw new InvalidOperationException("CustodialWallet:MasterKey must be base64.", exception); }
        }
        if (!development) throw new InvalidOperationException("Configure CustodialWallet__MasterKey outside Development.");
        if (File.Exists(settings.MasterKeyFile))
            return new WalletKeyVault(Convert.FromBase64String(File.ReadAllText(settings.MasterKeyFile).Trim()));
        Directory.CreateDirectory(Path.GetDirectoryName(settings.MasterKeyFile)!);
        var key = RandomNumberGenerator.GetBytes(32);
        // CreateNew: never overwrite a key that existing ciphertext depends on.
        using (var file = new FileStream(settings.MasterKeyFile, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        using (var writer = new StreamWriter(file, Encoding.ASCII))
            writer.Write(Convert.ToBase64String(key));
        return new WalletKeyVault(key);
    }

    public byte[] Protect(Guid userId, string address, byte[] privateKey)
    {
        var output = new byte[1 + NonceSize + TagSize + privateKey.Length];
        output[0] = Version;
        var nonce = output.AsSpan(1, NonceSize);
        RandomNumberGenerator.Fill(nonce);
        using var aes = new AesGcm(masterKey, TagSize);
        aes.Encrypt(nonce, privateKey, output.AsSpan(1 + NonceSize + TagSize), output.AsSpan(1 + NonceSize, TagSize), Context(userId, address));
        return output;
    }

    public byte[] Unprotect(Guid userId, string address, byte[] stored)
    {
        if (stored.Length <= 1 + NonceSize + TagSize || stored[0] != Version)
            throw new CryptographicException("Unsupported custodial key format.");
        var plaintext = new byte[stored.Length - 1 - NonceSize - TagSize];
        using var aes = new AesGcm(masterKey, TagSize);
        aes.Decrypt(stored.AsSpan(1, NonceSize), stored.AsSpan(1 + NonceSize + TagSize), stored.AsSpan(1 + NonceSize, TagSize), plaintext, Context(userId, address));
        return plaintext;
    }

    private static byte[] Context(Guid userId, string address) => Encoding.UTF8.GetBytes($"{userId:D}|{address.ToLowerInvariant()}");
}
