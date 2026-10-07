using System.Globalization;
using System.IO.Compression;
using System.Numerics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using StudentEscrow.Application.Common;
using StudentEscrow.Domain.Orders;

namespace StudentEscrow.Application.Orders;

public static class OrderRules
{
    public const long ProductLimit = 50_000_000;
    public const long EvidenceLimit = 5_000_000;
    public const long TotalLimit = 75_000_000;
    public static string Hash(byte[] bytes) => "0x" + Convert.ToHexStringLower(SHA256.HashData(bytes));

    public static void Validate(CreateDraftRequest request, long now)
    {
        if (string.IsNullOrWhiteSpace(request.Description) || request.Description.Length > 4000
            || string.IsNullOrWhiteSpace(request.AcceptanceCriteria) || request.AcceptanceCriteria.Length > 4000
            || !BigInteger.TryParse(request.AmountWei, NumberStyles.None, CultureInfo.InvariantCulture, out var amount)
            || amount <= 0 || amount >= BigInteger.Pow(10, 38) || amount.ToString(CultureInfo.InvariantCulture) != request.AmountWei
            || request.DeliveryDeadline <= now || request.ReviewWindow is < 1 or > 31536000)
            throw new ApplicationError("INVALID_TERMS", "Check terms, integer wei amount and future deadline.", 400);
    }

    // Fixed property order, UTF-8, no whitespace. Return the exact bytes as TermsJson for clients.
    public static void Seal(OrderDraft draft, long chainId, string contract)
    {
        draft.TermsJson = JsonSerializer.Serialize(new
        {
            version = 1, chainId, contract, deploymentId = draft.DeploymentId,
            clientReference = draft.ClientReference, buyer = draft.Buyer, seller = draft.Seller,
            arbiter = draft.Arbiter, description = draft.Description, acceptanceCriteria = draft.AcceptanceCriteria,
            amountWei = draft.AmountWei, deliveryDeadline = draft.DeliveryDeadline, reviewWindow = draft.ReviewWindow,
            feeBps = 100
        });
        draft.TermsHash = Hash(Encoding.UTF8.GetBytes(draft.TermsJson));
    }

    public static bool Matches(OrderDraft draft, ChainOrder order) =>
        draft.DeploymentId == order.DeploymentId && draft.ClientReference == order.ClientReference
        && draft.Buyer == order.Buyer && draft.Seller == order.Seller && draft.Arbiter == order.Arbiter
        && draft.AmountWei == order.AmountWei && draft.TermsHash == order.TermsHash
        && draft.DeliveryDeadline == order.DeliveryDeadline && draft.ReviewWindow == order.ReviewWindow;

    public static async Task<byte[]> ReadFileAsync(Stream source, string kind, string name, CancellationToken ct)
    {
        var limit = kind switch { "product" => ProductLimit, "evidence" => EvidenceLimit,
            _ => throw new ApplicationError("INVALID_FILE_KIND", "Use product or evidence.", 400) };
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int count;
        while ((count = await source.ReadAsync(chunk, ct)) != 0)
        {
            if (buffer.Length + count > limit) throw new ApplicationError("FILE_TOO_LARGE", "File exceeds its byte limit.", 413);
            await buffer.WriteAsync(chunk.AsMemory(0, count), ct);
        }
        var bytes = buffer.ToArray();
        if (bytes.Length == 0) throw new ApplicationError("EMPTY_FILE", "File must not be empty.", 400);
        var extension = Path.GetExtension(name).ToLowerInvariant();
        var valid = false;
        if (kind == "product" && extension == ".zip")
        {
            try
            {
                using var zip = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read);
                // Inspect the directory only; never extract or execute uploaded content.
                valid = zip.Entries.Count is > 0 and <= 10000 && zip.Entries.Any(e => e.Length > 0)
                    && zip.Entries.All(e => !e.FullName.Replace('\\', '/').Split('/').Contains("..")
                        && !e.FullName.StartsWith('/') && !e.FullName.Contains(':'));
            }
            catch (Exception ex) when (ex is InvalidDataException or IOException or ArgumentException) { valid = false; }
        }
        else if (kind == "evidence")
        {
            valid = extension switch
            {
                ".png" => EvidenceFormat.IsPng(bytes),
                ".jpg" or ".jpeg" => EvidenceFormat.IsJpeg(bytes),
                ".pdf" => EvidenceFormat.IsPdf(bytes),
                _ => false
            };
        }
        if (!valid) throw new ApplicationError("INVALID_FILE_FORMAT", "Content does not match an allowed file format.", 400);
        return bytes;
    }

    public static void CheckQuota(IEnumerable<(string Kind, long Length)> existing, string kind, long length)
    {
        var files = existing.ToArray();
        if ((kind == "product" && files.Any(f => f.Kind == "product"))
            || (kind == "evidence" && files.Count(f => f.Kind == "evidence") >= 5)
            || files.Sum(f => f.Length) + length > TotalLimit)
            throw new ApplicationError("FILE_QUOTA", "One immutable product ZIP and at most five evidence files per order.", 409);
    }
}
