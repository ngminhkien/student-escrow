using Microsoft.EntityFrameworkCore;
using StudentEscrow.Domain.Orders;
using StudentEscrow.Infrastructure.Persistence;

namespace StudentEscrow.Infrastructure.Demo;

public sealed record DemoResetResult(string BackupFile, IReadOnlyList<string> KycVerifiedWallets);

// A new local chain makes everything derived from the old one false. Accounts, wallets, keys and KYC do not depend on it and stay.
public static class DemoReset
{
    public static async Task<DemoResetResult> RunAsync(StudentEscrowDbContext db, CancellationToken ct)
    {
        var backup = await BackupAsync(db, ct);
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await db.LedgerEntries.ExecuteDeleteAsync(ct);
        await db.LedgerAccounts.ExecuteUpdateAsync(set => set.SetProperty(account => account.BalanceWei, 0m), ct);
        await db.DepositRequests.ExecuteDeleteAsync(ct);
        await db.Set<OrderFile>().ExecuteDeleteAsync(ct);
        await db.Set<OrderDraft>().ExecuteDeleteAsync(ct);
        await db.Set<ChainEvent>().ExecuteDeleteAsync(ct);
        await db.Set<ChainBlock>().ExecuteDeleteAsync(ct);
        await db.Set<ChainArbiter>().ExecuteDeleteAsync(ct);
        await db.Set<ChainOrder>().ExecuteDeleteAsync(ct);
        await db.Set<ChainDeployment>().ExecuteDeleteAsync(ct);
        await transaction.CommitAsync(ct);
        var wallets = await (from kyc in db.KycSubmissions.AsNoTracking()
                             join link in db.WalletLinks.AsNoTracking() on kyc.WalletLinkId equals link.Id
                             where kyc.Status == "VERIFIED"
                             select link.Address).ToListAsync(ct);
        return new DemoResetResult(backup, wallets);
    }

    // A relative name lands in SQL Server's backup folder. Only the latest is kept, so repeated runs do not fill the disk.
    private static async Task<string> BackupAsync(StudentEscrowDbContext db, CancellationToken ct)
    {
        var name = db.Database.GetDbConnection().Database;
        var file = name + "_before_demo_run.bak";
        var previousTimeout = db.Database.GetCommandTimeout();
        db.Database.SetCommandTimeout(TimeSpan.FromMinutes(5));
        await db.Database.ExecuteSqlAsync($"BACKUP DATABASE {name} TO DISK = {file} WITH INIT, CHECKSUM", ct);
        db.Database.SetCommandTimeout(previousTimeout);
        return file;
    }
}
