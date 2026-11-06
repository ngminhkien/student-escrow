using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using StudentEscrow.Domain.Kyc;
using StudentEscrow.Domain.Ledger;
using StudentEscrow.Domain.Orders;
using StudentEscrow.Domain.Users;
using StudentEscrow.Domain.Wallets;
using StudentEscrow.Infrastructure.Demo;
using StudentEscrow.Infrastructure.Persistence;
using Xunit;

namespace StudentEscrow.Application.Tests;

[Collection("Sql")]
public sealed class DemoResetTests
{
    // The reset empties whole tables, so it must never run in a database the other tests or a person might be pointing at.
    private const string DatabaseName = "StudentEscrowResetTest";

    private static StudentEscrowDbContext Database() => new(new DbContextOptionsBuilder<StudentEscrowDbContext>()
        .UseSqlServer(new SqlConnectionStringBuilder(Environment.GetEnvironmentVariable("STUDENT_ESCROW_SQL_TEST_CONNECTION")) { InitialCatalog = DatabaseName }.ConnectionString).Options);

    private static async Task<Guid> AddUser(StudentEscrowDbContext db, string address, string? kycDecision)
    {
        var now = DateTimeOffset.UtcNow;
        var id = Guid.NewGuid();
        var link = new WalletLink(Guid.NewGuid(), id, address, 31337, now, isCustodial: kycDecision is null);
        db.Add(new User(id, $"{address}@example.test", "Reset Test", "hash", now));
        db.Add(link);
        if (kycDecision is not null)
        {
            var kyc = new KycSubmission(Guid.NewGuid(), id, link.Id, "Reset Test", "DEMO-123456", "doc", "selfie", now);
            kyc.ApplyMockDecision(kycDecision == "VERIFIED", kycDecision == "VERIFIED", now);
            db.Add(kyc);
        }
        await db.SaveChangesAsync();
        return id;
    }

    [SqlFact]
    public async Task ChainHistoryGoesWhileAccountsWalletsAndKycStay()
    {
        await using var db = Database();
        await db.Database.EnsureDeletedAsync();
        await db.Database.MigrateAsync();
        try
        {
            var verified = "0x" + new string('a', 40);
            var user = await AddUser(db, verified, "VERIFIED");
            await AddUser(db, "0x" + new string('b', 40), "REJECTED");
            await AddUser(db, "0x" + new string('c', 40), null);
            var now = DateTimeOffset.UtcNow;
            var deployment = Guid.NewGuid();
            var account = new LedgerAccount(user, now);
            account.Apply(500m, now);
            var draftId = Guid.NewGuid();
            db.AddRange(account,
                new LedgerEntry { Id = Guid.NewGuid(), UserId = user, Type = LedgerEntryType.GatewayDeposit, AmountWei = 500m, BalanceAfterWei = 500m, IdempotencyKey = "k", CreatedAt = now },
                new DepositRequest(Guid.NewGuid(), user, 100_000, Guid.NewGuid(), "mock", now, now.AddMinutes(15)),
                new ChainDeployment { Id = deployment, ChainId = 31337, ContractAddress = verified, TransactionHash = "0x1" },
                new ChainBlock { DeploymentId = deployment, Number = 1, Hash = "0x2" },
                new ChainEvent { DeploymentId = deployment, TransactionHash = "0x3", Name = "Deposited", Payload = "{}" },
                new ChainArbiter { DeploymentId = deployment, Address = verified, Approved = true },
                new ChainOrder { DeploymentId = deployment, OrderId = "1", ClientReference = "0x4" },
                new OrderDraft { Id = draftId, BuyerUserId = user, DeploymentId = deployment, ClientReference = "0x4", CreatedAt = now },
                new OrderFile { Id = Guid.NewGuid(), DraftId = draftId, UploadedBy = user, Kind = "product", FileName = "a.zip", Sha256 = "0x5", CreatedAt = now },
                new ChatMessage { DraftId = draftId, Seq = 1, SenderUserId = user, SenderRole = "Buyer", Text = "x", CreatedAt = now },
                new ChatReadState { DraftId = draftId, UserId = user, LastReadSeq = 1 });
            await db.SaveChangesAsync();

            var result = await DemoReset.RunAsync(db, default);

            Assert.Equal(DatabaseName + "_before_demo_run.bak", result.BackupFile);
            Assert.Equal([verified], result.KycVerifiedWallets);
            await using var check = Database();
            Assert.Equal(3, await check.Users.CountAsync());
            Assert.Equal(3, await check.WalletLinks.CountAsync());
            Assert.Equal(2, await check.KycSubmissions.CountAsync());
            Assert.Equal(0m, (await check.LedgerAccounts.SingleAsync(item => item.UserId == user)).BalanceWei);
            Assert.False(await check.LedgerEntries.AnyAsync());
            Assert.False(await check.DepositRequests.AnyAsync());
            Assert.False(await check.Set<ChatMessage>().AnyAsync());
            Assert.False(await check.Set<ChatReadState>().AnyAsync());
            Assert.False(await check.Set<OrderFile>().AnyAsync());
            Assert.False(await check.Set<OrderDraft>().AnyAsync());
            Assert.False(await check.Set<ChainEvent>().AnyAsync());
            Assert.False(await check.Set<ChainBlock>().AnyAsync());
            Assert.False(await check.Set<ChainArbiter>().AnyAsync());
            Assert.False(await check.Set<ChainOrder>().AnyAsync());
            Assert.False(await check.Set<ChainDeployment>().AnyAsync());
        }
        finally
        {
            SqlConnection.ClearAllPools();
            await db.Database.EnsureDeletedAsync();
        }
    }
}
