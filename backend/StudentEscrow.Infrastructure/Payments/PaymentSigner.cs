using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace StudentEscrow.Infrastructure.Payments;

public sealed class PaymentSettings
{
    // Allows the simulated gateway, which pays without moving real money. Program.cs refuses it outside Development.
    public bool MockEnabled { get; set; }
    // Base64 of at least 32 random bytes. Takes precedence over WebhookSecretFile.
    public string WebhookSecret { get; set; } = string.Empty;
    // Development only: created on first use.
    public string WebhookSecretFile { get; set; } = "../../.runtime/payment-webhook.key";
}

// HMAC-SHA256 over the fields that decide money, so a webhook cannot be forged or altered in transit.
public sealed class PaymentSigner
{
    private const int MinimumSecretBytes = 32;
    private readonly byte[] secret;

    public PaymentSigner(byte[] secret)
    {
        if (secret.Length < MinimumSecretBytes) throw new InvalidOperationException("The payment webhook secret must be at least 32 bytes.");
        this.secret = secret;
    }

    public static PaymentSigner Load(PaymentSettings settings, bool development)
    {
        if (!string.IsNullOrWhiteSpace(settings.WebhookSecret))
        {
            try { return new PaymentSigner(Convert.FromBase64String(settings.WebhookSecret)); }
            catch (FormatException exception) { throw new InvalidOperationException("Payments:WebhookSecret must be base64.", exception); }
        }
        if (!development) throw new InvalidOperationException("Configure Payments__WebhookSecret outside Development.");
        if (File.Exists(settings.WebhookSecretFile))
            return new PaymentSigner(Convert.FromBase64String(File.ReadAllText(settings.WebhookSecretFile).Trim()));
        Directory.CreateDirectory(Path.GetDirectoryName(settings.WebhookSecretFile)!);
        var key = RandomNumberGenerator.GetBytes(MinimumSecretBytes);
        using (var file = new FileStream(settings.WebhookSecretFile, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        using (var writer = new StreamWriter(file, Encoding.ASCII))
            writer.Write(Convert.ToBase64String(key));
        return new PaymentSigner(key);
    }

    public string Sign(Guid depositId, long amountVnd, string status, string gatewayTransactionId, long timestamp)
    {
        var canonical = string.Join('|', depositId.ToString("N"), amountVnd.ToString(CultureInfo.InvariantCulture), status,
            gatewayTransactionId, timestamp.ToString(CultureInfo.InvariantCulture));
        return Convert.ToHexStringLower(HMACSHA256.HashData(secret, Encoding.UTF8.GetBytes(canonical)));
    }

    public bool Verify(Guid depositId, long amountVnd, string status, string gatewayTransactionId, long timestamp, string signature) =>
        CryptographicOperations.FixedTimeEquals(
            Encoding.ASCII.GetBytes(Sign(depositId, amountVnd, status, gatewayTransactionId, timestamp)),
            Encoding.ASCII.GetBytes(signature));
}
