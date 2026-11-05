using System.Numerics;
using StudentEscrow.Application.Analytics;
using StudentEscrow.Application.Common;
using StudentEscrow.Application.Orders;
using StudentEscrow.Application.Risk;
using StudentEscrow.Infrastructure.Risk;
using StudentEscrow.RiskTraining;
using Xunit;

namespace StudentEscrow.Application.Tests;

public sealed class RiskFeatureTests
{
    private static readonly DateTimeOffset Now = new(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);

    [Fact]
    public void NothingAtOrAfterTheScoringTimeIsVisible()
    {
        var history = new[]
        {
            // Funded before, but its dispute and refund only happen later: must count as a clean prior order.
            new SellerOrderFact(1, Now.AddDays(-2), Now.AddDays(1), Now.AddDays(2)),
            new SellerOrderFact(1, Now.AddDays(-30), Now.AddDays(-29), Now.AddDays(-28)),
            new SellerOrderFact(100, Now, null, null),
            new SellerOrderFact(100, Now.AddDays(1), null, null)
        };
        var features = RiskFeatureBuilder.Build(2, Now.AddDays(-10), Now.AddDays(-40), history, Now);
        Assert.Equal(2, features.SellerPriorFundedCount);
        Assert.Equal(0.5, features.SellerPriorDisputeRate);
        Assert.Equal(0.5, features.SellerPriorRefundRate);
        Assert.Equal(1, features.SellerOrdersLast7Days);
        Assert.Equal(2, features.AmountToSellerHistoricalMean);
        Assert.False(features.SellerHistoryMissing);
    }

    [Fact]
    public void NoHistoryIsFlaggedAndUsesNeutralValuesInsteadOfDividingByZero()
    {
        var features = RiskFeatureBuilder.Build(3, null, Now.AddDays(1), [], Now);
        Assert.True(features.SellerHistoryMissing);
        Assert.Equal(0, features.SellerPriorDisputeRate);
        Assert.Equal(0, features.SellerPriorRefundRate);
        Assert.Equal(1, features.AmountToSellerHistoricalMean);
        Assert.Equal(0, features.BuyerAccountAgeDays);
        Assert.Equal(0, features.SellerAccountAgeDays);
        Assert.Contains(RuleBasedRisk.Evaluate(features).Reasons, reason => reason.Contains("chưa có lịch sử"));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(double.NaN)]
    public void InvalidAmountIsRejected(double amount) =>
        Assert.Throws<ArgumentOutOfRangeException>(() => RiskFeatureBuilder.Build(amount, Now, Now, [], Now));
}

public sealed class RuleBasedRiskTests
{
    private static RiskFeatures Features(double age = 100, int prior = 10, double dispute = 0, double refund = 0, int recent = 0, double ratio = 1) =>
        new(1, 100, age, prior, dispute, refund, recent, ratio, prior == 0);

    [Theory]
    [InlineData(6.99, 20)]
    [InlineData(7, 0)]
    public void NewAccountRule(double age, int score) => Assert.Equal(score, RuleBasedRisk.Evaluate(Features(age: age)).Score);

    [Theory]
    [InlineData(5, 0.21, 25)]
    [InlineData(5, 0.20, 0)]
    [InlineData(4, 0.90, 0)]
    public void DisputeRuleNeedsFivePriorOrders(int prior, double rate, int score) =>
        Assert.Equal(score, RuleBasedRisk.Evaluate(Features(prior: prior, dispute: rate)).Score);

    [Theory]
    [InlineData(5, 0.21, 15)]
    [InlineData(5, 0.20, 0)]
    [InlineData(4, 0.90, 0)]
    public void RefundRuleNeedsFivePriorOrders(int prior, double rate, int score) =>
        Assert.Equal(score, RuleBasedRisk.Evaluate(Features(prior: prior, refund: rate)).Score);

    [Theory]
    [InlineData(5, 3.01, 25)]
    [InlineData(5, 3, 0)]
    [InlineData(4, 9, 0)]
    public void AmountRuleNeedsFivePriorOrders(int prior, double ratio, int score) =>
        Assert.Equal(score, RuleBasedRisk.Evaluate(Features(prior: prior, ratio: ratio)).Score);

    [Theory]
    [InlineData(11, 15)]
    [InlineData(10, 0)]
    public void FrequencyRule(int recent, int score) => Assert.Equal(score, RuleBasedRisk.Evaluate(Features(recent: recent)).Score);

    [Fact]
    public void AllRulesReachAtMostOneHundredAndShowTheThreeHeaviestReasons()
    {
        var result = RuleBasedRisk.Evaluate(Features(age: 1, dispute: 1, refund: 1, recent: 20, ratio: 10));
        Assert.Equal(100, result.Score);
        Assert.Equal(3, result.Reasons.Count);
        Assert.DoesNotContain(result.Reasons, reason => reason.Contains("hoàn tiền"));
    }

    [Theory]
    [InlineData(0, "LOW")]
    [InlineData(39, "LOW")]
    [InlineData(40, "MEDIUM")]
    [InlineData(69, "MEDIUM")]
    [InlineData(70, "HIGH")]
    [InlineData(100, "HIGH")]
    public void LevelBoundaries(int score, string level) => Assert.Equal(level, RiskLevels.Of(score));

    [Theory]
    [InlineData(0.394, 39)]
    [InlineData(0.395, 40)]
    [InlineData(1.5, 100)]
    [InlineData(-0.5, 0)]
    public void ProbabilityRoundsAndClamps(double probability, int score) => Assert.Equal(score, RiskLevels.ScoreOf(probability));
}

public sealed class RiskEvaluatorTests
{
    private sealed class StubModel(double? probability) : IRiskModel
    {
        public string? Version => "stub";
        public string? DataSource => "synthetic";
        public double? Predict(RiskFeatures features) => probability;
    }

    private static readonly RiskFeatures Sample = new(1, 100, 1, 0, 0, 0, 0, 1, true);

    [Fact]
    public void ModelScoreIsLabelledAsMlWithRuleBasedReasons()
    {
        var result = RiskEvaluator.Evaluate(Sample, new StubModel(0.87), DateTimeOffset.UnixEpoch);
        Assert.Equal(87, result.Score);
        Assert.Equal("HIGH", result.Level);
        Assert.Equal("ml", result.ScoringSource);
        Assert.Equal("rule-based", result.ReasonSource);
        Assert.Equal("stub", result.ModelVersion);
        Assert.Equal("synthetic", result.DataSource);
    }

    [Theory]
    [InlineData(null)]
    [InlineData(double.NaN)]
    public void ModelFailureFallsBackToTheBaselineAndSaysSo(double? probability)
    {
        var result = RiskEvaluator.Evaluate(Sample, new StubModel(probability), DateTimeOffset.UnixEpoch);
        Assert.Equal(20, result.Score);
        Assert.Equal("rule-based", result.ScoringSource);
        Assert.Null(result.ModelVersion);
    }

    [Fact]
    public void UnavailableIsNotALowScore()
    {
        var result = RiskEvaluator.Unavailable(DateTimeOffset.UnixEpoch);
        Assert.Null(result.Score);
        Assert.Equal("UNAVAILABLE", result.Level);
        Assert.Equal("unavailable", result.ScoringSource);
    }
}

public sealed class MlRiskModelTests
{
    private static string Repository()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "StudentEscrow.slnx"))) directory = directory.Parent;
        return directory?.FullName ?? throw new InvalidOperationException("Repository root not found.");
    }
    private static string ModelDirectory => Path.Combine(Repository(), "analytics", "ai", "model");
    private static readonly RiskFeatures Calm = new(0.01, 200, 300, 12, 0, 0, 1, 1, false);
    private static readonly RiskFeatures Alarming = new(0.2, 2, 1, 12, 0.7, 0.5, 14, 8, false);

    private static string CopyModel()
    {
        var target = Directory.CreateTempSubdirectory("risk-model-").FullName;
        foreach (var file in Directory.GetFiles(ModelDirectory)) File.Copy(file, Path.Combine(target, Path.GetFileName(file)));
        return target;
    }

    [Fact]
    public void CommittedModelLoadsAndRanksAnAlarmingOrderAboveACalmOne()
    {
        var model = new MlRiskModel(ModelDirectory);
        Assert.Equal("logistic-v1", model.Version);
        Assert.Equal("synthetic", model.DataSource);
        var calm = model.Predict(Calm);
        var alarming = model.Predict(Alarming);
        Assert.InRange(calm!.Value, 0, 1);
        Assert.InRange(alarming!.Value, 0, 1);
        Assert.True(alarming > calm);
    }

    [Fact]
    public void ConcurrentPredictionsGiveTheSameAnswer()
    {
        var model = new MlRiskModel(ModelDirectory);
        var expected = model.Predict(Alarming);
        var results = new double?[400];
        Parallel.For(0, results.Length, index => results[index] = model.Predict(Alarming));
        Assert.All(results, result => Assert.Equal(expected, result));
    }

    [Fact]
    public void AlteredModelFileIsRefusedAndScoringFallsBack()
    {
        var directory = CopyModel();
        try
        {
            File.AppendAllText(Path.Combine(directory, MlRiskModel.ModelFile), "tampered");
            var model = new MlRiskModel(directory);
            Assert.Null(model.Predict(Calm));
            Assert.Equal("rule-based", RiskEvaluator.Evaluate(Calm, model, DateTimeOffset.UnixEpoch).ScoringSource);
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public void ModelFromAnotherFeatureVersionIsRefused()
    {
        var directory = CopyModel();
        try
        {
            var metadata = Path.Combine(directory, MlRiskModel.MetadataFile);
            File.WriteAllText(metadata, File.ReadAllText(metadata).Replace($"\"featureVersion\": \"{RiskFeatures.Version}\"", "\"featureVersion\": \"v0\""));
            Assert.Null(new MlRiskModel(directory).Predict(Calm));
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public void MissingModelFallsBack() => Assert.Null(new MlRiskModel(Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"))).Predict(Calm));

    [Fact]
    public void CommittedSeedMatchesTheParserAndIsMarkedSynthetic()
    {
        var seed = AnalyticsSeed.Parse(File.ReadAllLines(Path.Combine(Repository(), "analytics", "data", "analytics-seed.csv")));
        Assert.InRange(seed.Orders.Count, 200, 1000);
        Assert.All(seed.Orders, order => Assert.NotNull(order.Features));
        Assert.True(seed.TransactionCount > seed.Orders.Count);
    }

    [Fact]
    public void SeedWithoutTheSyntheticMarkIsRejected()
    {
        var cells = Enumerable.Repeat("0", AnalyticsSeed.Columns.Length).ToArray();
        cells[15] = "chain";
        Assert.Throws<ApplicationError>(() => AnalyticsSeed.Parse([string.Join(',', AnalyticsSeed.Columns), string.Join(',', cells)]));
    }
}

public sealed class SimulatorTests
{
    private static readonly (string, int)[] Splits = [("train", 30), ("validation", 10), ("test", 10)];

    [Fact]
    public void NoUserAppearsInTwoSplits()
    {
        var orders = Simulator.Run(7, Splits);
        var sellers = orders.GroupBy(order => order.Seller).Select(group => group.Select(order => order.Split).Distinct().Count());
        var buyers = orders.GroupBy(order => order.Buyer).Select(group => group.Select(order => order.Split).Distinct().Count());
        Assert.All(sellers, count => Assert.Equal(1, count));
        Assert.All(buyers, count => Assert.Equal(1, count));
    }

    [Fact]
    public void SameSeedGivesTheSameData()
    {
        var first = Simulator.Run(7, Splits);
        var second = Simulator.Run(7, Splits);
        Assert.Equal(first.Select(order => (order.Id, order.AmountWei, order.RiskLabel, order.Features)), second.Select(order => (order.Id, order.AmountWei, order.RiskLabel, order.Features)));
        Assert.NotEqual(first.Select(order => order.AmountWei), Simulator.Run(8, Splits).Select(order => order.AmountWei));
    }

    [Fact]
    public void FeaturesOnlySeeOrdersFundedEarlier()
    {
        foreach (var seller in Simulator.Run(7, Splits).GroupBy(order => order.Seller))
        {
            var chronological = seller.OrderBy(order => order.FundedAt).ToList();
            for (var index = 0; index < chronological.Count; index++) Assert.Equal(index, chronological[index].Features.SellerPriorFundedCount);
        }
    }

    [Fact]
    public void BothLabelsAndAllOutcomesOccur()
    {
        var orders = Simulator.Run(7, Splits);
        Assert.Contains(orders, order => order.RiskLabel);
        Assert.Contains(orders, order => !order.RiskLabel);
        Assert.Equal(["Completed", "Refunded", "Resolved"], orders.Select(order => order.Result).Distinct().Order());
        Assert.All(orders, order => Assert.Equal(order.AmountWei, order.BuyerRefundWei + order.SellerGrossWei));
    }
}

public sealed class BinaryMetricsTests
{
    [Fact]
    public void ConfusionMatrixAndDerivedMetrics()
    {
        var result = BinaryMetrics.At([(0.9, true), (0.8, false), (0.2, true), (0.1, false)], 0.5);
        Assert.Equal((1, 1, 1, 1), (result.TruePositive, result.FalsePositive, result.TrueNegative, result.FalseNegative));
        Assert.Equal(0.5, result.Precision);
        Assert.Equal(0.5, result.Recall);
        Assert.Equal(0.5, result.F1);
    }

    [Fact]
    public void AucHandlesPerfectInvertedAndTiedScores()
    {
        Assert.Equal(1, BinaryMetrics.RocAuc([(0.9, true), (0.1, false)]));
        Assert.Equal(0, BinaryMetrics.RocAuc([(0.1, true), (0.9, false)]));
        Assert.Equal(0.5, BinaryMetrics.RocAuc([(0.5, true), (0.5, false)]));
        Assert.True(double.IsNaN(BinaryMetrics.RocAuc([(0.5, true)])));
    }

    [Fact]
    public void NoPredictedPositivesGivesZeroInsteadOfDividingByZero() =>
        Assert.Equal(0, BinaryMetrics.At([(0.1, true)], 0.5).F1);
}

public sealed class AnalyticsCalculatorTests
{
    private sealed class NoModel : IRiskModel
    {
        public string? Version => null;
        public string? DataSource => null;
        public double? Predict(RiskFeatures features) => null;
    }

    private static AnalyticsOrder Order(string state, long amount = 100, bool disputed = false, long refund = 0, long net = 0, long fee = 0, string category = "design", RiskFeatures? features = null) =>
        new(amount, category, state, disputed, refund, net, fee, features);

    private static AnalyticsSummary Summary(params AnalyticsOrder[] orders) =>
        AnalyticsCalculator.Summarize("chain", 31337, Guid.NewGuid(), DateTimeOffset.UnixEpoch, 5, [], orders, 9, new NoModel(), DateTimeOffset.UnixEpoch);

    [Fact]
    public void NoFundedOrdersGiveZerosInsteadOfDividingByZero()
    {
        var result = Summary();
        Assert.Equal(0, result.FundedOrderCount);
        Assert.Equal(0, result.CompletionRate);
        Assert.Equal("0", result.AverageFundedWei);
        Assert.Equal("unavailable", result.RiskDistribution.ScoringSource);
    }

    [Fact]
    public void RatesFollowTheAgreedDefinitions()
    {
        var result = Summary(
            Order("Completed", 100, net: 99, fee: 1),
            // Resolved with everything back to the Buyer: counts as disputed and as a full refund, not as completed.
            Order("Resolved", 200, disputed: true, refund: 200),
            // Split decision: disputed, but not a full refund.
            Order("Resolved", 300, disputed: true, refund: 100, net: 198, fee: 2),
            Order("Refunded", 400, refund: 400),
            // Still in progress, and still in every denominator.
            Order("Funded", 500));
        Assert.Equal(5, result.FundedOrderCount);
        Assert.Equal(0.2, result.CompletionRate);
        Assert.Equal(0.4, result.DisputeRate);
        Assert.Equal(0.4, result.FullRefundRate);
        Assert.Equal("1500", result.TotalEscrowVolumeWei);
        Assert.Equal("300", result.AverageFundedWei);
        Assert.Equal("297", result.SellerNetWei);
        Assert.Equal("700", result.BuyerRefundWei);
        Assert.Equal("3", result.PlatformFeeWei);
        Assert.Equal(9, result.BlockchainTransactionCount);
    }

    [Fact]
    public void AmountsDoNotLosePrecision()
    {
        var huge = BigInteger.Parse("99999999999999999999999999999999999999");
        var result = Summary(new AnalyticsOrder(huge, "design", "Funded", false, 0, 0, 0, null), new AnalyticsOrder(huge, "design", "Funded", false, 0, 0, 0, null));
        Assert.Equal((huge * 2).ToString(), result.TotalEscrowVolumeWei);
        Assert.Equal(huge.ToString(), result.AverageFundedWei);
    }

    [Fact]
    public void CategoriesAreSortedAndUncategorizedStaysVisible()
    {
        var result = Summary(Order("Funded", category: "programming"), Order("Funded", category: OrderCategories.Uncategorized), Order("Funded", category: "programming"));
        Assert.Equal([new CategoryCount("programming", 2), new CategoryCount(OrderCategories.Uncategorized, 1)], result.TopCategories);
    }

    [Fact]
    public void DistributionNamesTheBaselineWhenTheModelIsOff()
    {
        var low = new RiskFeatures(1, 100, 100, 10, 0, 0, 0, 1, false);
        var medium = new RiskFeatures(1, 100, 1, 10, 0.5, 0, 0, 1, false);
        var high = new RiskFeatures(1, 100, 1, 10, 0.5, 0, 0, 5, false);
        var result = Summary(Order("Funded", features: low), Order("Funded", features: medium), Order("Funded", features: high), Order("Funded")).RiskDistribution;
        Assert.Equal((1, 1, 1, 1), (result.Low, result.Medium, result.High, result.Unavailable));
        Assert.Equal("rule-based", result.ScoringSource);
        Assert.Null(result.ModelVersion);
    }
}

public sealed class OrderCategoryTests
{
    [Fact]
    public void CategoryIsOptionalButCheckedWhenGiven()
    {
        Assert.Null(OrderCategories.Normalize(null));
        Assert.Equal("design", OrderCategories.Normalize("design"));
        Assert.Throws<ApplicationError>(() => OrderCategories.Normalize("anything"));
    }
}
