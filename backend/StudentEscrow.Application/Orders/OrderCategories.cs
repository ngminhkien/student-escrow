using StudentEscrow.Application.Common;

namespace StudentEscrow.Application.Orders;

// Off-chain label for analytics. It stays out of the hashed terms, so it never affects what the contract commits to.
public static class OrderCategories
{
    public const string Uncategorized = "uncategorized";
    public static readonly IReadOnlyList<string> Allowed = ["design", "programming", "documents", "other"];

    public static string? Normalize(string? category)
    {
        if (category is null) return null;
        return Allowed.Contains(category) ? category
            : throw new ApplicationError("INVALID_CATEGORY", "Loại dịch vụ không hợp lệ.", 400);
    }
}
