namespace StudentEscrow.Application.Risk;

// Bump FeatureVersion whenever a definition below changes: a saved model is only valid for the version it was trained on.
public sealed record RiskFeatures(
    double AmountEth,
    double BuyerAccountAgeDays,
    double SellerAccountAgeDays,
    int SellerPriorFundedCount,
    double SellerPriorDisputeRate,
    double SellerPriorRefundRate,
    int SellerOrdersLast7Days,
    double AmountToSellerHistoricalMean,
    bool SellerHistoryMissing)
{
    public const string Version = "v1";
    public static readonly IReadOnlyList<string> Names =
    [
        nameof(AmountEth), nameof(BuyerAccountAgeDays), nameof(SellerAccountAgeDays), nameof(SellerPriorFundedCount),
        nameof(SellerPriorDisputeRate), nameof(SellerPriorRefundRate), nameof(SellerOrdersLast7Days),
        nameof(AmountToSellerHistoricalMean), nameof(SellerHistoryMissing)
    ];
}

// One other funded order of the Seller. The caller leaves out the order being scored.
public sealed record SellerOrderFact(double AmountEth, DateTimeOffset FundedAt, DateTimeOffset? DisputedAt, DateTimeOffset? FullRefundAt);

public static class RiskFeatureBuilder
{
    public const double WeiPerEth = 1_000_000_000_000_000_000d;

    // Training and inference both come through here, so the two cannot define a feature differently.
    // Anything that happened at or after asOf is invisible, including the outcome of an order funded earlier.
    public static RiskFeatures Build(double amountEth, DateTimeOffset? buyerCreatedAt, DateTimeOffset? sellerCreatedAt,
        IEnumerable<SellerOrderFact> sellerHistory, DateTimeOffset asOf)
    {
        if (!double.IsFinite(amountEth) || amountEth <= 0) throw new ArgumentOutOfRangeException(nameof(amountEth));
        var prior = sellerHistory.Where(order => order.FundedAt < asOf).ToList();
        var mean = prior.Count == 0 ? 0 : prior.Average(order => order.AmountEth);
        return new RiskFeatures(
            amountEth,
            AgeDays(buyerCreatedAt, asOf),
            AgeDays(sellerCreatedAt, asOf),
            prior.Count,
            Rate(prior.Count(order => order.DisputedAt < asOf), prior.Count),
            Rate(prior.Count(order => order.FullRefundAt < asOf), prior.Count),
            prior.Count(order => order.FundedAt >= asOf.AddDays(-7)),
            mean > 0 ? amountEth / mean : 1,
            prior.Count == 0);
    }

    // An account the platform cannot find has no standing, so it counts as brand new rather than as established.
    private static double AgeDays(DateTimeOffset? createdAt, DateTimeOffset asOf) =>
        createdAt is null ? 0 : Math.Max(0, (asOf - createdAt.Value).TotalDays);
    private static double Rate(int part, int whole) => whole == 0 ? 0 : (double)part / whole;
}

public static class RuleBasedRisk
{
    public const int MinimumHistory = 5;
    public const int NewAccountDays = 7, NewAccountPoints = 20;
    public const double DisputeRateLimit = 0.20; public const int DisputePoints = 25;
    public const double RefundRateLimit = 0.20; public const int RefundPoints = 15;
    public const double AmountRatioLimit = 3; public const int AmountPoints = 25;
    public const int FrequencyLimit = 10, FrequencyPoints = 15;
    public const int MaximumReasons = 3;

    public static (int Score, IReadOnlyList<string> Reasons) Evaluate(RiskFeatures f)
    {
        var enough = f.SellerPriorFundedCount >= MinimumHistory;
        (bool Applies, int Points, string Reason)[] rules =
        [
            (f.SellerAccountAgeDays < NewAccountDays, NewAccountPoints, $"Tài khoản Seller mới ({Math.Floor(f.SellerAccountAgeDays):0} ngày)"),
            (enough && f.SellerPriorDisputeRate > DisputeRateLimit, DisputePoints, $"Tỷ lệ tranh chấp lịch sử của Seller cao ({f.SellerPriorDisputeRate:P0} trên {f.SellerPriorFundedCount} đơn)"),
            (enough && f.SellerPriorRefundRate > RefundRateLimit, RefundPoints, $"Tỷ lệ hoàn tiền lịch sử của Seller cao ({f.SellerPriorRefundRate:P0} trên {f.SellerPriorFundedCount} đơn)"),
            (enough && f.AmountToSellerHistoricalMean > AmountRatioLimit, AmountPoints, $"Số tiền lớn gấp {f.AmountToSellerHistoricalMean:0.#} lần trung bình các đơn trước của Seller"),
            (f.SellerOrdersLast7Days > FrequencyLimit, FrequencyPoints, $"Seller có {f.SellerOrdersLast7Days} đơn trong 7 ngày qua"),
            // Scores nothing but must be said: having no history is not evidence of safety.
            (f.SellerHistoryMissing, 0, "Seller chưa có lịch sử giao dịch để đối chiếu")
        ];
        var fired = rules.Where(rule => rule.Applies).OrderByDescending(rule => rule.Points).ToList();
        return (Math.Clamp(fired.Sum(rule => rule.Points), 0, 100), fired.Take(MaximumReasons).Select(rule => rule.Reason).ToList());
    }
}

public static class RiskLevels
{
    public const string Low = "LOW", Medium = "MEDIUM", High = "HIGH", Unavailable = "UNAVAILABLE";
    public static string Of(int score) => score < 40 ? Low : score < 70 ? Medium : High;
    public static int ScoreOf(double probability) => Math.Clamp((int)Math.Round(probability * 100, MidpointRounding.AwayFromZero), 0, 100);
}

public static class ScoringSources
{
    public const string Ml = "ml", RuleBased = "rule-based", Unavailable = "unavailable";
}

// Implementations must be safe for concurrent use and return null instead of throwing when they cannot score.
public interface IRiskModel
{
    string? Version { get; }
    string? DataSource { get; }
    double? Predict(RiskFeatures features);
}

public sealed record RiskResponse(int? Score, string Level, IReadOnlyList<string> Reasons, string ReasonSource, string ScoringSource,
    string? ModelVersion, string FeatureVersion, DateTimeOffset EvaluatedAt, string? DataSource);

public static class RiskEvaluator
{
    public static RiskResponse Evaluate(RiskFeatures features, IRiskModel model, DateTimeOffset evaluatedAt)
    {
        var rules = RuleBasedRisk.Evaluate(features);
        var probability = model.Predict(features);
        // The reasons are rule conditions either way. They do not explain what the model weighed.
        return probability is { } value && double.IsFinite(value)
            ? Scored(RiskLevels.ScoreOf(value), rules.Reasons, ScoringSources.Ml, model.Version, evaluatedAt, model.DataSource)
            : Scored(rules.Score, rules.Reasons, ScoringSources.RuleBased, null, evaluatedAt, "rules");
    }

    // Never a low score: "could not evaluate" must not read as "looks safe".
    public static RiskResponse Unavailable(DateTimeOffset evaluatedAt) =>
        new(null, RiskLevels.Unavailable, [], ScoringSources.RuleBased, ScoringSources.Unavailable, null, RiskFeatures.Version, evaluatedAt, null);

    private static RiskResponse Scored(int score, IReadOnlyList<string> reasons, string source, string? version, DateTimeOffset at, string? data) =>
        new(score, RiskLevels.Of(score), reasons, ScoringSources.RuleBased, source, version, RiskFeatures.Version, at, data);
}
