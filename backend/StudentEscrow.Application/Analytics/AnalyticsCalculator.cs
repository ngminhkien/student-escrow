using System.Numerics;
using StudentEscrow.Application.Risk;

namespace StudentEscrow.Application.Analytics;

public static class AnalyticsSources
{
    public const string Chain = "chain", Synthetic = "synthetic";
}

// An order that was funded at least once. Orders that never received a deposit are not analytics subjects.
public sealed record AnalyticsOrder(BigInteger AmountWei, string Category, string State, bool EverDisputed,
    BigInteger BuyerRefundWei, BigInteger SellerNetWei, BigInteger PlatformFeeWei, RiskFeatures? Features);

public sealed record CategoryCount(string Category, int Count);
public sealed record RiskDistribution(int Low, int Medium, int High, int Unavailable, string ScoringSource, string? ModelVersion);
public sealed record AnalyticsDeployment(Guid Id, long ChainId, string ContractAddress, bool Active);

public sealed record AnalyticsSummary(
    string Source, long? ChainId, Guid? DeploymentId, DateTimeOffset? SnapshotAt, long? LastBlock,
    IReadOnlyList<AnalyticsDeployment> Deployments,
    int FundedOrderCount, int BlockchainTransactionCount, string TotalEscrowVolumeWei, string AverageFundedWei,
    int CompletedCount, double CompletionRate, int DisputedCount, double DisputeRate, int FullRefundCount, double FullRefundRate,
    string SellerNetWei, string BuyerRefundWei, string PlatformFeeWei,
    IReadOnlyList<CategoryCount> TopCategories, RiskDistribution RiskDistribution);

public static class AnalyticsCalculator
{
    public static AnalyticsSummary Summarize(string source, long? chainId, Guid? deploymentId, DateTimeOffset? snapshotAt, long? lastBlock,
        IReadOnlyList<AnalyticsDeployment> deployments, IReadOnlyList<AnalyticsOrder> funded, int transactionCount, IRiskModel model, DateTimeOffset now)
    {
        var volume = Sum(funded, order => order.AmountWei);
        var completed = funded.Count(order => order.State == "Completed");
        var disputed = funded.Count(order => order.EverDisputed);
        var refunded = funded.Count(order => order.BuyerRefundWei == order.AmountWei);
        return new AnalyticsSummary(source, chainId, deploymentId, snapshotAt, lastBlock, deployments,
            funded.Count, transactionCount, volume.ToString(), (funded.Count == 0 ? BigInteger.Zero : volume / funded.Count).ToString(),
            completed, Rate(completed, funded.Count), disputed, Rate(disputed, funded.Count), refunded, Rate(refunded, funded.Count),
            Sum(funded, order => order.SellerNetWei).ToString(), Sum(funded, order => order.BuyerRefundWei).ToString(),
            Sum(funded, order => order.PlatformFeeWei).ToString(),
            funded.GroupBy(order => order.Category).Select(group => new CategoryCount(group.Key, group.Count()))
                .OrderByDescending(item => item.Count).ThenBy(item => item.Category, StringComparer.Ordinal).ToList(),
            Distribution(funded, model, now));
    }

    private static RiskDistribution Distribution(IReadOnlyList<AnalyticsOrder> funded, IRiskModel model, DateTimeOffset now)
    {
        int low = 0, medium = 0, high = 0, unavailable = 0, ml = 0;
        string? version = null;
        foreach (var order in funded)
        {
            if (order.Features is null) { unavailable++; continue; }
            var risk = RiskEvaluator.Evaluate(order.Features, model, now);
            if (risk.ScoringSource == ScoringSources.Ml) { ml++; version = risk.ModelVersion; }
            switch (risk.Level)
            {
                case RiskLevels.Low: low++; break;
                case RiskLevels.Medium: medium++; break;
                case RiskLevels.High: high++; break;
                default: unavailable++; break;
            }
        }
        var scored = low + medium + high;
        var source = scored == 0 ? ScoringSources.Unavailable : ml == scored ? ScoringSources.Ml : ScoringSources.RuleBased;
        return new RiskDistribution(low, medium, high, unavailable, source, source == ScoringSources.Ml ? version : null);
    }

    private static BigInteger Sum(IEnumerable<AnalyticsOrder> orders, Func<AnalyticsOrder, BigInteger> value) =>
        orders.Aggregate(BigInteger.Zero, (total, order) => total + value(order));
    private static double Rate(int part, int whole) => whole == 0 ? 0 : (double)part / whole;
}
