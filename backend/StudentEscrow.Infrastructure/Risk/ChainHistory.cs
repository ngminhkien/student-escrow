using System.Numerics;
using Microsoft.EntityFrameworkCore;
using StudentEscrow.Application.Risk;
using StudentEscrow.Domain.Orders;
using StudentEscrow.Infrastructure.Persistence;

namespace StudentEscrow.Infrastructure.Risk;

public sealed record ChainOrderFacts(ChainOrder Order, DateTimeOffset? FundedAt, DateTimeOffset? DisputedAt, DateTimeOffset? FullRefundAt)
{
    public double AmountEth => (double)BigInteger.Parse(Order.AmountWei) / RiskFeatureBuilder.WeiPerEth;
    public SellerOrderFact? ToFact() => FundedAt is { } funded ? new SellerOrderFact(AmountEth, funded, DisputedAt, FullRefundAt) : null;
}

// Times come from verified events and their blocks, never from anything a client sent.
public static class ChainHistory
{
    private static readonly string[] Names = ["Deposited", "Disputed", "Refunded", "Resolved"];

    public static async Task<IReadOnlyList<ChainOrderFacts>> LoadAsync(StudentEscrowDbContext db, Guid deploymentId, CancellationToken ct)
    {
        var orders = await db.Set<ChainOrder>().AsNoTracking().Where(order => order.DeploymentId == deploymentId).ToListAsync(ct);
        var events = await (from ev in db.Set<ChainEvent>().AsNoTracking()
                            join block in db.Set<ChainBlock>().AsNoTracking()
                                on new { ev.DeploymentId, Number = ev.BlockNumber } equals new { block.DeploymentId, block.Number }
                            where ev.DeploymentId == deploymentId && ev.OrderId != null && Names.Contains(ev.Name)
                            select new { ev.OrderId, ev.Name, block.Timestamp }).ToListAsync(ct);
        var times = events.ToLookup(ev => ev.OrderId);
        DateTimeOffset? At(string orderId, params string[] names) =>
            times[orderId].Where(ev => names.Contains(ev.Name)).Select(ev => (DateTimeOffset?)DateTimeOffset.FromUnixTimeSeconds(ev.Timestamp)).FirstOrDefault();
        return orders.Select(order => new ChainOrderFacts(order, At(order.OrderId, "Deposited"), At(order.OrderId, "Disputed"),
            order.BuyerRefundWei == order.AmountWei ? At(order.OrderId, "Refunded", "Resolved") : null)).ToList();
    }

    public static async Task<Dictionary<string, DateTimeOffset>> AccountCreationByWalletAsync(StudentEscrowDbContext db, CancellationToken ct)
    {
        var rows = await (from link in db.WalletLinks.AsNoTracking()
                          join user in db.Users.AsNoTracking() on link.UserId equals user.Id
                          select new { link.Address, user.CreatedAt }).ToListAsync(ct);
        return rows.ToDictionary(row => row.Address.ToLowerInvariant(), row => row.CreatedAt);
    }
}
