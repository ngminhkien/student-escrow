using System.Globalization;
using System.Numerics;
using System.Text;
using StudentEscrow.Application.Risk;
using StudentEscrow.Application.Wallets;
using StudentEscrow.Infrastructure.Risk;

namespace StudentEscrow.RiskTraining;

public sealed record SimulatedOrder(string Id, string Split, string Buyer, string Seller, string Persona, string Category, BigInteger AmountWei,
    DateTimeOffset CreatedAt, DateTimeOffset FundedAt, DateTimeOffset? DeliveredAt, DateTimeOffset SettledAt, bool EverDisputed,
    BigInteger BuyerRefundWei, BigInteger SellerGrossWei, string Result, RiskFeatures Features, bool RiskLabel)
{
    public double AmountEth => (double)AmountWei / RiskFeatureBuilder.WeiPerEth;
}

// Invented marketplace behaviour, not a model of real fraud. Everything the report says about the model is about this process.
//
// How the label arises: each Seller has a hidden persona the features never see. An order's bad-outcome chance depends on that persona,
// on a large amount, on a very new account and on Gaussian noise. RiskLabel is whether that order ended in a dispute or full refund,
// flipped at random for 3% of orders. So the model has to infer the persona from past behaviour; the label is not a formula over the features.
public static class Simulator
{
    public static readonly DateTimeOffset Start = new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
    public const int HorizonDays = 120;
    private const double LabelNoise = 0.03;
    private static readonly (string Name, double Share, double Logit)[] Personas =
        [("reliable", 0.65, -3.0), ("careless", 0.25, -1.4), ("risky", 0.10, 0.0)];
    private static readonly (string Name, double Share)[] Categories =
        [("design", 0.40), ("programming", 0.40), ("documents", 0.15), ("other", 0.05)];

    // Users are assigned to a split before any transaction exists, and each split has its own Buyers and Sellers.
    public static List<SimulatedOrder> Run(int seed, IReadOnlyList<(string Split, int Sellers)> splits)
    {
        var random = new Random(seed);
        var orders = new List<SimulatedOrder>();
        var number = 0;
        foreach (var (split, sellerCount) in splits)
        {
            var buyers = Enumerable.Range(0, Math.Max(10, sellerCount * 2)).Select(index =>
                (Id: $"{split}-buyer-{index:0000}", CreatedAt: Start.AddDays(-Uniform(random, 1, 400)))).ToArray();
            for (var index = 0; index < sellerCount; index++)
                orders.AddRange(SellerOrders(random, split, $"{split}-seller-{index:0000}", buyers, ref number));
        }
        return orders;
    }

    private static List<SimulatedOrder> SellerOrders(Random random, string split, string seller, (string Id, DateTimeOffset CreatedAt)[] buyers, ref int number)
    {
        var persona = Pick(random, Personas, item => item.Share);
        var risky = persona.Name == "risky";
        var createdAt = risky ? Start.AddDays(Uniform(random, -10, HorizonDays - 20)) : Start.AddDays(-Uniform(random, 5, 400));
        var typicalVnd = 1_200_000 * Math.Exp(Gaussian(random) * 0.5);
        var count = risky ? random.Next(4, 22) : persona.Name == "careless" ? random.Next(2, 16) : random.Next(1, 14);
        var from = createdAt > Start ? createdAt : Start;
        // Risky Sellers are active in a short burst; the others spread orders over the whole period.
        var windowDays = risky ? Uniform(random, 4, 20) : Math.Max(1, (Start.AddDays(HorizonDays) - from).TotalDays);
        var times = Enumerable.Range(0, count).Select(_ => from.AddDays(random.NextDouble() * windowDays)).OrderBy(time => time).ToList();
        var history = new List<SellerOrderFact>();
        var result = new List<SimulatedOrder>();
        foreach (var fundedAt in times)
        {
            var spike = random.NextDouble() < (risky ? 0.25 : 0.04);
            var vnd = typicalVnd * Math.Exp(Gaussian(random) * 0.35) * (spike ? Uniform(random, 3.5, 8) : 1);
            var amountWei = new BigInteger(Math.Clamp(Math.Round(vnd / 10_000) * 10_000, 10_000, 50_000_000)) * ExchangeRate.WeiPerVnd;
            var amountEth = (double)amountWei / RiskFeatureBuilder.WeiPerEth;
            var buyer = buyers[random.Next(buyers.Length)];
            var features = RiskFeatureBuilder.Build(amountEth, buyer.CreatedAt, createdAt, history, fundedAt);

            var chance = Sigmoid(persona.Logit + (spike ? 1.0 : 0) + ((fundedAt - createdAt).TotalDays < 7 ? 0.6 : 0) + Gaussian(random) * 0.6);
            var bad = random.NextDouble() < chance;
            var order = Outcome(random, split, ++number, seller, buyer.Id, persona.Name, amountWei, fundedAt, bad, features);
            result.Add(order);
            history.Add(new SellerOrderFact(amountEth, fundedAt, order.EverDisputed ? order.FundedAt.AddDays(1) : null,
                order.BuyerRefundWei == amountWei ? order.SettledAt : null));
        }
        return result;
    }

    private static SimulatedOrder Outcome(Random random, string split, int number, string seller, string buyer, string persona, BigInteger amountWei,
        DateTimeOffset fundedAt, bool bad, RiskFeatures features)
    {
        var category = Pick(random, Categories, item => item.Share).Name;
        var createdAt = fundedAt.AddHours(-Uniform(random, 1, 48));
        var label = random.NextDouble() < LabelNoise ? !bad : bad;
        var id = $"syn-{number:00000}";
        if (!bad)
        {
            var delivered = fundedAt.AddDays(Uniform(random, 0.5, 5));
            return new(id, split, buyer, seller, persona, category, amountWei, createdAt, fundedAt, delivered, delivered.AddDays(Uniform(random, 0.2, 2)),
                false, BigInteger.Zero, amountWei, "Completed", features, label);
        }
        if (random.NextDouble() < 0.3)
            return new(id, split, buyer, seller, persona, category, amountWei, createdAt, fundedAt, null, fundedAt.AddDays(Uniform(random, 3, 14)),
                false, amountWei, BigInteger.Zero, "Refunded", features, label);
        // Disputed: Arbiters here refund everything in 30% of cases and otherwise split.
        var sellerBps = random.NextDouble() < 0.3 ? 0 : random.Next(1, 11) * 1000;
        var gross = amountWei * sellerBps / 10_000;
        return new(id, split, buyer, seller, persona, category, amountWei, createdAt, fundedAt, fundedAt.AddDays(Uniform(random, 0.5, 5)),
            fundedAt.AddDays(Uniform(random, 3, 14)), true, amountWei - gross, gross, "Resolved", features, label);
    }

    public static void WriteDataset(string path, IEnumerable<SimulatedOrder> orders)
    {
        var output = new StringBuilder(string.Join(',', new[] { "split", "orderId", "buyer", "seller", "persona", "riskLabel" }.Concat(RiskFeatures.Names))).Append('\n');
        foreach (var order in orders)
            output.Append(string.Join(',', new[] { order.Split, order.Id, order.Buyer, order.Seller, order.Persona, order.RiskLabel ? "1" : "0" }.Concat(FeatureCells(order.Features)))).Append('\n');
        File.WriteAllText(path, output.ToString(), new UTF8Encoding(false));
    }

    // A snapshot of a running platform: anything not settled by the cut-off is still in progress and has no settlement figures yet.
    public static void WriteAnalyticsSeed(string path, IEnumerable<SimulatedOrder> orders, DateTimeOffset cutOff)
    {
        var output = new StringBuilder(string.Join(',', AnalyticsSeed.Columns)).Append('\n');
        foreach (var order in orders.Where(order => order.FundedAt <= cutOff).OrderBy(order => order.FundedAt))
        {
            var settled = order.SettledAt <= cutOff;
            var delivered = order.DeliveredAt <= cutOff ? order.DeliveredAt : null;
            var gross = settled ? order.SellerGrossWei : BigInteger.Zero;
            var fee = gross / 100;
            var state = settled ? order.Result : order.EverDisputed && order.FundedAt.AddDays(1) <= cutOff ? "Disputed" : delivered is null ? "Funded" : "Delivered";
            var everDisputed = order.EverDisputed && order.FundedAt.AddDays(1) <= cutOff;
            // create, accept, deposit, then one each for delivery, dispute and settlement when they happened.
            var transactions = 3 + (delivered is null ? 0 : 1) + (everDisputed ? 1 : 0) + (settled ? 1 : 0);
            output.Append(string.Join(',', new[]
            {
                order.Id, order.Buyer, order.Seller, order.Category, order.AmountWei.ToString(), Time(order.CreatedAt), Time(order.FundedAt), Time(delivered),
                settled ? Time(order.SettledAt) : "", everDisputed ? "true" : "false", (settled ? order.BuyerRefundWei : BigInteger.Zero).ToString(),
                gross.ToString(), (gross - fee).ToString(), fee.ToString(), state, "synthetic", "0", transactions.ToString(CultureInfo.InvariantCulture)
            }.Concat(FeatureCells(order.Features)))).Append('\n');
        }
        File.WriteAllText(path, output.ToString(), new UTF8Encoding(false));
    }

    private static IEnumerable<string> FeatureCells(RiskFeatures f) =>
        new[] { f.AmountEth, f.BuyerAccountAgeDays, f.SellerAccountAgeDays, f.SellerPriorFundedCount, f.SellerPriorDisputeRate, f.SellerPriorRefundRate,
            f.SellerOrdersLast7Days, f.AmountToSellerHistoricalMean, f.SellerHistoryMissing ? 1 : 0 }.Select(value => value.ToString("R", CultureInfo.InvariantCulture));
    private static string Time(DateTimeOffset? value) => value?.ToString("O", CultureInfo.InvariantCulture) ?? "";
    private static double Sigmoid(double value) => 1 / (1 + Math.Exp(-value));
    private static double Uniform(Random random, double min, double max) => min + random.NextDouble() * (max - min);
    private static double Gaussian(Random random) => Math.Sqrt(-2 * Math.Log(1 - random.NextDouble())) * Math.Cos(2 * Math.PI * random.NextDouble());
    private static T Pick<T>(Random random, IReadOnlyList<T> items, Func<T, double> share)
    {
        var roll = random.NextDouble();
        foreach (var item in items)
        {
            roll -= share(item);
            if (roll <= 0) return item;
        }
        return items[^1];
    }
}
