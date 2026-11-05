using System.Globalization;
using System.Numerics;
using System.Text;
using Microsoft.EntityFrameworkCore;
using StudentEscrow.Application.Analytics;
using StudentEscrow.Application.Common;
using StudentEscrow.Application.Orders;
using StudentEscrow.Application.Risk;
using StudentEscrow.Domain.Orders;
using StudentEscrow.Infrastructure.Orders;
using StudentEscrow.Infrastructure.Persistence;

namespace StudentEscrow.Infrastructure.Risk;

public sealed class AnalyticsService(StudentEscrowDbContext db, ManifestProvider manifests, RiskSettings settings, IRiskModel model, TimeProvider clock)
{
    public async Task<AnalyticsSummary> SummaryAsync(string source, Guid? deploymentId, CancellationToken ct) => source switch
    {
        AnalyticsSources.Chain => await ChainAsync(deploymentId, ct),
        AnalyticsSources.Synthetic => await SyntheticAsync(ct),
        _ => throw new ApplicationError("INVALID_SOURCE", "Nguồn dữ liệu phải là chain hoặc synthetic.", 400)
    };

    private async Task<AnalyticsSummary> ChainAsync(Guid? deploymentId, CancellationToken ct)
    {
        Guid? active = null;
        try { active = (await manifests.ReadAsync(ct)).DeploymentId; }
        catch (Exception exception) when (exception is IOException or InvalidDataException or InvalidOperationException or System.Text.Json.JsonException) { }
        var rows = await db.Set<ChainDeployment>().AsNoTracking().ToListAsync(ct);
        var deployments = rows.Select(row => new AnalyticsDeployment(row.Id, row.ChainId, row.ContractAddress, row.Id == active)).ToList();
        if (deploymentId is not null && rows.All(row => row.Id != deploymentId))
            throw new ApplicationError("DEPLOYMENT_NOT_FOUND", "Không tìm thấy deployment.", 404);
        var deployment = rows.FirstOrDefault(row => row.Id == (deploymentId ?? active));
        if (deployment is null)
            return AnalyticsCalculator.Summarize(AnalyticsSources.Chain, null, null, null, null, deployments, [], 0, model, clock.GetUtcNow());

        var history = await ChainHistory.LoadAsync(db, deployment.Id, ct);
        var accounts = await ChainHistory.AccountCreationByWalletAsync(db, ct);
        var drafts = await db.Set<OrderDraft>().AsNoTracking().Where(draft => draft.DeploymentId == deployment.Id)
            .Select(draft => new { draft.Buyer, draft.ClientReference, draft.Category }).ToListAsync(ct);
        var categories = drafts.ToDictionary(draft => (draft.Buyer.ToLowerInvariant(), draft.ClientReference), draft => draft.Category);
        var bySeller = history.ToLookup(item => item.Order.Seller);
        var funded = new List<AnalyticsOrder>();
        foreach (var item in history.Where(item => item.FundedAt is not null))
        {
            var order = item.Order;
            // Scored as of its own deposit, so the chart does not change when later orders settle.
            var features = RiskFeatureBuilder.Build(item.AmountEth, accounts.TryGetValue(order.Buyer, out var buyerAt) ? buyerAt : null,
                accounts.TryGetValue(order.Seller, out var sellerAt) ? sellerAt : null,
                bySeller[order.Seller].Where(other => other.Order.OrderId != order.OrderId).Select(other => other.ToFact()).OfType<SellerOrderFact>(),
                item.FundedAt!.Value);
            funded.Add(new AnalyticsOrder(BigInteger.Parse(order.AmountWei), categories.GetValueOrDefault((order.Buyer, order.ClientReference)) ?? OrderCategories.Uncategorized,
                order.State, item.DisputedAt is not null, BigInteger.Parse(order.BuyerRefundWei), BigInteger.Parse(order.SellerNetWei), BigInteger.Parse(order.PlatformFeeWei), features));
        }
        var hashes = await db.Set<ChainEvent>().AsNoTracking().Where(ev => ev.DeploymentId == deployment.Id)
            .Select(ev => ev.TransactionHash).Distinct().CountAsync(ct);
        return AnalyticsCalculator.Summarize(AnalyticsSources.Chain, deployment.ChainId, deployment.Id, deployment.CheckedAt, deployment.LastBlock,
            deployments, funded, hashes, model, clock.GetUtcNow());
    }

    private async Task<AnalyticsSummary> SyntheticAsync(CancellationToken ct)
    {
        string[] lines;
        try { lines = await File.ReadAllLinesAsync(settings.SyntheticDataPath, Encoding.UTF8, ct); }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        { throw new ApplicationError("SYNTHETIC_DATA_UNAVAILABLE", "Chưa có dữ liệu giả lập. Chạy console huấn luyện để tạo.", 503); }
        var seed = AnalyticsSeed.Parse(lines);
        return AnalyticsCalculator.Summarize(AnalyticsSources.Synthetic, null, null, seed.SnapshotAt, null, [], seed.Orders, seed.TransactionCount, model, clock.GetUtcNow());
    }
}

public sealed record AnalyticsSeedData(IReadOnlyList<AnalyticsOrder> Orders, int TransactionCount, DateTimeOffset? SnapshotAt);

// The training console writes this file and the API reads it, so the columns are defined once.
public static class AnalyticsSeed
{
    public static readonly string[] Columns =
    [
        "orderId", "buyer", "seller", "category", "amountWei", "createdAt", "fundedAt", "deliveredAt", "settledAt", "everDisputed",
        "buyerRefundWei", "sellerGrossWei", "sellerNetWei", "platformFeeWei", "result", "source", "chainId", "txCount",
        .. RiskFeatures.Names
    ];

    public static AnalyticsSeedData Parse(IReadOnlyList<string> lines)
    {
        if (lines.Count == 0 || lines[0] != string.Join(',', Columns)) throw new ApplicationError("SYNTHETIC_DATA_INVALID", "Dữ liệu giả lập không đúng định dạng.", 503);
        var orders = new List<AnalyticsOrder>();
        var transactions = 0;
        DateTimeOffset? snapshot = null;
        foreach (var line in lines.Skip(1).Where(line => line.Length > 0))
        {
            var cell = line.Split(',');
            if (cell.Length != Columns.Length || cell[15] != AnalyticsSources.Synthetic) throw new ApplicationError("SYNTHETIC_DATA_INVALID", "Dữ liệu giả lập không đúng định dạng.", 503);
            double Number(int index) => double.Parse(cell[index], CultureInfo.InvariantCulture);
            transactions += int.Parse(cell[17], CultureInfo.InvariantCulture);
            foreach (var time in new[] { cell[6], cell[7], cell[8] }.Where(value => value.Length > 0).Select(value => DateTimeOffset.Parse(value, CultureInfo.InvariantCulture)))
                if (snapshot is null || time > snapshot) snapshot = time;
            orders.Add(new AnalyticsOrder(BigInteger.Parse(cell[4]), cell[3], cell[14], cell[9] == "true", BigInteger.Parse(cell[10]), BigInteger.Parse(cell[12]), BigInteger.Parse(cell[13]),
                new RiskFeatures(Number(18), Number(19), Number(20), (int)Number(21), Number(22), Number(23), (int)Number(24), Number(25), Number(26) != 0)));
        }
        return new AnalyticsSeedData(orders, transactions, snapshot);
    }
}
