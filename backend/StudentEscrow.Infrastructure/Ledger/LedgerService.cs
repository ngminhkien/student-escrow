using System.Globalization;
using Microsoft.EntityFrameworkCore;
using StudentEscrow.Application.Common;
using StudentEscrow.Application.Wallets;
using StudentEscrow.Domain.Ledger;
using StudentEscrow.Domain.Orders;
using StudentEscrow.Infrastructure.Orders;
using StudentEscrow.Infrastructure.Persistence;

namespace StudentEscrow.Infrastructure.Ledger;

public sealed record LedgerPosting(Guid UserId, string Type, decimal AmountWei, string IdempotencyKey,
    Guid? DeploymentId = null, string? OrderId = null, string? TransactionHash = null, long? BlockNumber = null,
    Guid? ActorUserId = null, string? Note = null, bool AllowNegative = false);

public sealed class LedgerService(StudentEscrowDbContext db, TimeProvider clock)
{
    private static readonly string[] Terminal = ["Completed", "Resolved", "Refunded"];

    public static decimal ParseWei(string wei) =>
        decimal.TryParse(wei, NumberStyles.None, CultureInfo.InvariantCulture, out var value)
            ? value : throw new ApplicationError("AMOUNT_TOO_LARGE", "Số tiền vượt quá giới hạn của sổ cái.", 409);

    public async Task<LedgerEntry?> PostAsync(LedgerPosting posting, CancellationToken ct)
    {
        if (db.Database.CurrentTransaction is not null) return await ApplyAsync(posting, ct);
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var entry = await ApplyAsync(posting, ct);
        await transaction.CommitAsync(ct);
        return entry;
    }

    // Returns null when this key was already posted, so a retry can never move money twice.
    private async Task<LedgerEntry?> ApplyAsync(LedgerPosting posting, CancellationToken ct)
    {
        await SqlLocks.AcquireAsync(db, "ledger:" + posting.UserId, ct);
        if (await db.LedgerEntries.AsNoTracking().AnyAsync(item => item.IdempotencyKey == posting.IdempotencyKey, ct)) return null;
        var now = clock.GetUtcNow();
        var account = await db.LedgerAccounts.SingleOrDefaultAsync(item => item.UserId == posting.UserId, ct);
        if (account is null)
        {
            account = new LedgerAccount(posting.UserId, now);
            db.Add(account);
        }
        if (posting.AmountWei < 0 && !posting.AllowNegative && account.BalanceWei + posting.AmountWei < 0)
            throw new ApplicationError("INSUFFICIENT_BALANCE",
                $"Số dư không đủ: cần {ExchangeRate.DisplayVnd(-posting.AmountWei)}, hiện có {ExchangeRate.DisplayVnd(account.BalanceWei)}.", 409);
        account.Apply(posting.AmountWei, now);
        var entry = new LedgerEntry
        {
            Id = Guid.NewGuid(), UserId = posting.UserId, Type = posting.Type, AmountWei = posting.AmountWei,
            BalanceAfterWei = account.BalanceWei, IdempotencyKey = posting.IdempotencyKey, DeploymentId = posting.DeploymentId,
            OrderId = posting.OrderId, TransactionHash = posting.TransactionHash, BlockNumber = posting.BlockNumber,
            ActorUserId = posting.ActorUserId, Note = posting.Note, CreatedAt = now
        };
        db.Add(entry);
        await db.SaveChangesAsync(ct);
        return entry;
    }

    // The escrow transaction did not execute: return the funds and free the key so the buyer can retry.
    public async Task ReleaseHoldAsync(LedgerEntry hold, string? note, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await ReverseAsync(hold, LedgerEntryType.EscrowHoldRelease, note, ct);
        await transaction.CommitAsync(ct);
    }

    private async Task ReverseAsync(LedgerEntry original, string type, string? note, CancellationToken ct)
    {
        var tracked = await db.LedgerEntries.SingleAsync(item => item.Id == original.Id, ct);
        if (tracked.ReversedAt is not null) return;
        await ApplyAsync(new LedgerPosting(tracked.UserId, type, -tracked.AmountWei, $"reversal:{tracked.Id}",
            tracked.DeploymentId, tracked.OrderId, tracked.TransactionHash, Note: note, AllowNegative: true), ct);
        tracked.ReversedAt = clock.GetUtcNow();
        tracked.IdempotencyKey = $"{tracked.IdempotencyKey}:reversed:{tracked.Id:N}";
        await db.SaveChangesAsync(ct);
    }

    // Runs inside the sync transaction, so a checkpoint and its credits commit or roll back together.
    public async Task ApplyChainEventAsync(ChainEvent ev, ChainOrder order, CancellationToken ct)
    {
        if (ev.Name is not ("Released" or "Resolved" or "Refunded")) return;
        await CreditPartyAsync(ev, order, order.Seller, "seller", order.SellerNetWei, LedgerEntryType.EscrowPayout, ct);
        await CreditPartyAsync(ev, order, order.Buyer, "buyer", order.BuyerRefundWei, LedgerEntryType.EscrowRefund, ct);
    }

    private async Task CreditPartyAsync(ChainEvent ev, ChainOrder order, string address, string role, string wei, string type, CancellationToken ct)
    {
        var amount = ParseWei(wei);
        if (amount == 0) return;
        var userId = await db.CustodialWallets.AsNoTracking().Where(item => item.Address == address)
            .Select(item => (Guid?)item.UserId).SingleOrDefaultAsync(ct);
        if (userId is null) return;
        await ApplyAsync(new LedgerPosting(userId.Value, type, amount, $"chain:{ev.DeploymentId:N}:{ev.BlockHash}:{ev.LogIndex}:{role}",
            ev.DeploymentId, order.OrderId, ev.TransactionHash, ev.BlockNumber, Note: ev.Name), ct);
    }

    // A reorg removed these events; rebuilding from the new canonical blocks posts them again if still valid.
    public async Task ReverseChainCreditsAsync(Guid deploymentId, long ancestor, CancellationToken ct)
    {
        var removed = await db.LedgerEntries.AsNoTracking()
            .Where(item => item.DeploymentId == deploymentId && item.BlockNumber > ancestor && item.ReversedAt == null
                && (item.Type == LedgerEntryType.EscrowPayout || item.Type == LedgerEntryType.EscrowRefund))
            .OrderBy(item => item.CreatedAt).ToListAsync(ct);
        foreach (var entry in removed) await ReverseAsync(entry, LedgerEntryType.ChainReversal, "Chain reorganized", ct);
    }

    // A local chain restart destroys unsettled escrow together with its deployment. The ledger outlives the chain,
    // so holds on orders that never settled go back to the buyer once a new deployment takes over.
    public async Task ReleaseArchivedHoldsAsync(Guid currentDeploymentId, CancellationToken ct)
    {
        var holds = await db.LedgerEntries.AsNoTracking()
            .Where(item => item.Type == LedgerEntryType.EscrowHold && item.ReversedAt == null && item.DeploymentId != currentDeploymentId)
            .ToListAsync(ct);
        foreach (var hold in holds)
        {
            var state = await db.Set<ChainOrder>().AsNoTracking().Where(item => item.DeploymentId == hold.DeploymentId && item.OrderId == hold.OrderId)
                .Select(item => item.State).SingleOrDefaultAsync(ct);
            if (state is null || !Terminal.Contains(state))
                await ReverseAsync(hold, LedgerEntryType.EscrowHoldRelease, "Local chain was replaced", ct);
        }
    }

    public async Task<WalletAccountResponse> AccountAsync(Guid userId, CancellationToken ct)
    {
        var wallet = await db.WalletLinks.AsNoTracking().SingleOrDefaultAsync(item => item.UserId == userId, ct);
        var balance = await db.LedgerAccounts.AsNoTracking().Where(item => item.UserId == userId)
            .Select(item => item.BalanceWei).SingleOrDefaultAsync(ct);
        var holds = await db.LedgerEntries.AsNoTracking()
            .Where(item => item.UserId == userId && item.Type == LedgerEntryType.EscrowHold && item.ReversedAt == null).ToListAsync(ct);
        var locked = 0m;
        foreach (var hold in holds)
        {
            var state = await db.Set<ChainOrder>().AsNoTracking().Where(item => item.DeploymentId == hold.DeploymentId && item.OrderId == hold.OrderId)
                .Select(item => item.State).SingleOrDefaultAsync(ct);
            if (state is null || !Terminal.Contains(state)) locked -= hold.AmountWei;
        }
        var entries = await db.LedgerEntries.AsNoTracking().Where(item => item.UserId == userId)
            .OrderByDescending(item => item.CreatedAt).ThenBy(item => item.Id).Take(50).ToListAsync(ct);
        return new(wallet?.IsCustodial == true, wallet?.Address, ExchangeRate.Format(balance), ExchangeRate.WeiToVnd(balance),
            ExchangeRate.Format(locked), ExchangeRate.WeiToVnd(locked), ExchangeRate.VndPerEth,
            entries.Select(item => new LedgerEntryResponse(item.Id, item.Type, ExchangeRate.Format(item.AmountWei),
                ExchangeRate.WeiToVnd(item.AmountWei), ExchangeRate.Format(item.BalanceAfterWei), item.OrderId,
                item.TransactionHash, item.Note, item.CreatedAt)).ToList());
    }
}
