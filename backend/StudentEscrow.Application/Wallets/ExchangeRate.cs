using System.Globalization;

namespace StudentEscrow.Application.Wallets;

// Fixed demo rate, not a market price. 1 VND is a whole number of wei, so VND to wei never rounds.
// frontend/src/domain/money.ts repeats these values; tests/rules.unit.ts fails if the two sides differ.
public static class ExchangeRate
{
    public const long VndPerEth = 100_000_000;
    public const long WeiPerVnd = 10_000_000_000;
    public const long MaxCreditVnd = 10_000_000_000;

    public static decimal VndToWei(long vnd) => vnd * (decimal)WeiPerVnd;
    public static string WeiToVnd(decimal wei) =>
        decimal.Truncate(wei / WeiPerVnd).ToString("F0", CultureInfo.InvariantCulture);
    public static string Format(decimal wei) => wei.ToString("F0", CultureInfo.InvariantCulture);
    public static string DisplayVnd(decimal wei) =>
        decimal.Truncate(wei / WeiPerVnd).ToString("N0", CultureInfo.GetCultureInfo("vi-VN")) + " VND";
}
