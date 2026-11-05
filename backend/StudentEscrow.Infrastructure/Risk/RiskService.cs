using System.Numerics;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using StudentEscrow.Application.Common;
using StudentEscrow.Application.Risk;
using StudentEscrow.Domain.Orders;
using StudentEscrow.Infrastructure.Persistence;

namespace StudentEscrow.Infrastructure.Risk;

// Advisory only: nothing here reaches the contract, the ledger, KYC or an order's state.
public sealed class RiskService(StudentEscrowDbContext db, IRiskModel model, TimeProvider clock, ILogger<RiskService> logger)
{
    // Callers check the Admin role first. Buyer, Seller and Arbiter do not see scores.
    public async Task<RiskResponse> AssessAsync(Guid draftId, CancellationToken ct)
    {
        var draft = await db.Set<OrderDraft>().AsNoTracking().SingleOrDefaultAsync(item => item.Id == draftId, ct)
            ?? throw new ApplicationError("ORDER_NOT_FOUND", "Order or file not found.", 404);
        var now = clock.GetUtcNow();
        try
        {
            var features = await FeaturesAsync(draft, now, ct);
            var response = RiskEvaluator.Evaluate(features, model, now);
            await RecordAsync(draft.Id, response, features, ct);
            return response;
        }
        catch (Exception exception) when (exception is not ApplicationError && !ct.IsCancellationRequested)
        {
            logger.LogWarning(exception, "Could not evaluate risk for order {OrderId}.", draftId);
            return RiskEvaluator.Unavailable(now);
        }
    }

    private async Task<RiskFeatures> FeaturesAsync(OrderDraft draft, DateTimeOffset now, CancellationToken ct)
    {
        var history = await ChainHistory.LoadAsync(db, draft.DeploymentId, ct);
        var accounts = await ChainHistory.AccountCreationByWalletAsync(db, ct);
        var seller = draft.Seller.ToLowerInvariant();
        var buyer = draft.Buyer.ToLowerInvariant();
        // A local chain can be moved ahead of the wall clock, and what it already recorded has happened.
        var latest = history.SelectMany(item => new[] { item.FundedAt, item.DisputedAt, item.FullRefundAt }).Max();
        var asOf = latest is { } value && value >= now ? value.AddSeconds(1) : now;
        var others = history.Where(item => item.Order.Seller.Equals(seller, StringComparison.OrdinalIgnoreCase)
                && !(item.Order.ClientReference == draft.ClientReference && item.Order.Buyer.Equals(buyer, StringComparison.OrdinalIgnoreCase)))
            .Select(item => item.ToFact()).OfType<SellerOrderFact>();
        return RiskFeatureBuilder.Build((double)BigInteger.Parse(draft.AmountWei) / RiskFeatureBuilder.WeiPerEth,
            accounts.TryGetValue(buyer, out var buyerAt) ? buyerAt : null, accounts.TryGetValue(seller, out var sellerAt) ? sellerAt : null, others, asOf);
    }

    // A new row only when the verdict changed, so reopening an order does not grow the table.
    private async Task RecordAsync(Guid draftId, RiskResponse response, RiskFeatures features, CancellationToken ct)
    {
        var last = await db.Set<RiskAssessment>().AsNoTracking().Where(item => item.DraftId == draftId)
            .OrderByDescending(item => item.EvaluatedAt).FirstOrDefaultAsync(ct);
        if (last is not null && last.Score == response.Score && last.ScoringSource == response.ScoringSource && last.ModelVersion == response.ModelVersion) return;
        db.Add(new RiskAssessment
        {
            Id = Guid.NewGuid(), DraftId = draftId, Score = response.Score, Level = response.Level, ScoringSource = response.ScoringSource,
            ModelVersion = response.ModelVersion, FeatureVersion = response.FeatureVersion, DataSource = response.DataSource,
            FeaturesJson = JsonSerializer.Serialize(features), EvaluatedAt = response.EvaluatedAt
        });
        await db.SaveChangesAsync(ct);
    }
}
