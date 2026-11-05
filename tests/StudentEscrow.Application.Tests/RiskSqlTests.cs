using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using StudentEscrow.Application.Common;
using StudentEscrow.Application.Risk;
using StudentEscrow.Domain.Orders;
using StudentEscrow.Domain.Users;
using StudentEscrow.Domain.Wallets;
using StudentEscrow.Infrastructure.Persistence;
using StudentEscrow.Infrastructure.Risk;
using Xunit;

namespace StudentEscrow.Application.Tests;

[Collection("Sql")]
public sealed class RiskSqlTests
{
    private static StudentEscrowDbContext Database() => new(new DbContextOptionsBuilder<StudentEscrowDbContext>()
        .UseSqlServer(Environment.GetEnvironmentVariable("STUDENT_ESCROW_SQL_TEST_CONNECTION")).Options);
    private static string Address() => "0x" + Guid.NewGuid().ToString("N") + "00000000";
    private static string Hash() => "0x" + Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N");

    private sealed class NoModel : IRiskModel
    {
        public string? Version => null;
        public string? DataSource => null;
        public double? Predict(RiskFeatures features) => null;
    }

    private static ChainDeployment Deployment() => new() { Id = Guid.NewGuid(), ChainId = 31337, ContractAddress = Address(), DeploymentBlock = 1,
        DeploymentBlockHash = Hash(), TransactionHash = Hash(), LastBlock = 1, LastBlockHash = Hash(), Status = "Ready" };

    // Adds a funded order with its Deposited event and, when asked, a dispute and full refund. Each event gets its own block.
    private static void Funded(StudentEscrowDbContext db, Guid deployment, string orderId, string buyer, string seller, string reference, DateTimeOffset at, bool disputedAndRefunded)
    {
        const string amount = "10000000000000000";
        db.Add(new ChainOrder { DeploymentId = deployment, OrderId = orderId, ClientReference = reference, Buyer = buyer, Seller = seller, Arbiter = Address(),
            AmountWei = amount, TermsHash = Hash(), State = disputedAndRefunded ? "Refunded" : "Funded", BuyerRefundWei = disputedAndRefunded ? amount : "0" });
        void Event(long number, string name)
        {
            var hash = Hash();
            db.Add(new ChainBlock { DeploymentId = deployment, Number = number, Hash = hash, Timestamp = at.ToUnixTimeSeconds() });
            db.Add(new ChainEvent { DeploymentId = deployment, TransactionHash = Hash(), LogIndex = 0, BlockNumber = number, BlockHash = hash, Name = name, OrderId = orderId, Payload = "{}" });
        }
        var first = long.Parse(orderId) * 10;
        Event(first, "Deposited");
        if (disputedAndRefunded) { Event(first + 1, "Disputed"); Event(first + 2, "Refunded"); }
    }

    [SqlFact]
    public async Task HistoryLeavesOutTheScoredOrderAndOtherDeploymentsAndRepeatsAreNotRecorded()
    {
        var now = DateTimeOffset.UtcNow;
        var (buyer, seller, buyerId, sellerId) = (Address(), Address(), Guid.NewGuid(), Guid.NewGuid());
        var (active, other) = (Deployment(), Deployment());
        var ownReference = Hash();
        var draft = new OrderDraft { Id = Guid.NewGuid(), BuyerUserId = buyerId, DeploymentId = active.Id, Buyer = buyer, Seller = seller, Arbiter = Address(),
            AmountWei = "10000000000000000", ClientReference = ownReference, TermsHash = Hash(), CreatedAt = now };
        await using (var db = Database())
        {
            db.Add(new User(buyerId, $"{Guid.NewGuid():N}@example.test", "Risk Buyer", "hash", now.AddDays(-50)));
            db.Add(new User(sellerId, $"{Guid.NewGuid():N}@example.test", "Risk Seller", "hash", now.AddDays(-100)));
            db.Add(new WalletLink(Guid.NewGuid(), buyerId, buyer, 31337, now));
            db.Add(new WalletLink(Guid.NewGuid(), sellerId, seller, 31337, now));
            db.AddRange(active, other, draft);
            // The scored order itself ended disputed and refunded. That must not count against it.
            Funded(db, active.Id, "1", buyer, seller, ownReference, now.AddDays(-20), true);
            for (var index = 2; index <= 6; index++)
                Funded(db, active.Id, index.ToString(), buyer, seller, Hash(), now.AddDays(-30), index <= 3);
            // Same Seller on a contract from an earlier run.
            Funded(db, other.Id, "7", buyer, seller, Hash(), now.AddDays(-30), true);
            await db.SaveChangesAsync();
        }

        await using var scoring = Database();
        var service = new RiskService(scoring, new NoModel(), TimeProvider.System, NullLogger<RiskService>.Instance);
        var result = await service.AssessAsync(draft.Id, default);
        Assert.Equal("rule-based", result.ScoringSource);
        Assert.Equal(40, result.Score); // 40% disputed (+25) and 40% refunded (+15). With the scored order counted, the rates would be 50%.
        Assert.Contains(result.Reasons, reason => reason.Contains("trên 5 đơn"));
        await service.AssessAsync(draft.Id, default);

        await using var check = Database();
        var saved = await check.Set<RiskAssessment>().Where(item => item.DraftId == draft.Id).SingleAsync();
        var features = JsonSerializer.Deserialize<RiskFeatures>(saved.FeaturesJson)!;
        Assert.Equal(5, features.SellerPriorFundedCount);
        Assert.Equal(0.4, features.SellerPriorDisputeRate);
        Assert.Equal(0.4, features.SellerPriorRefundRate);
        Assert.Equal(0, features.SellerOrdersLast7Days);
        Assert.InRange(features.SellerAccountAgeDays, 99, 101);
        Assert.InRange(features.BuyerAccountAgeDays, 49, 51);
        Assert.Equal(40, saved.Score);
        Assert.Null(saved.ModelVersion);
    }

    [SqlFact]
    public async Task UnknownOrderIsNotFound()
    {
        await using var db = Database();
        var service = new RiskService(db, new NoModel(), TimeProvider.System, NullLogger<RiskService>.Instance);
        Assert.Equal(404, (await Assert.ThrowsAsync<ApplicationError>(() => service.AssessAsync(Guid.NewGuid(), default))).StatusCode);
    }

    [SqlFact]
    public async Task AnOrderThatCannotBeScoredIsUnavailableNotLowRisk()
    {
        var (deployment, buyerId) = (Deployment(), Guid.NewGuid());
        var draft = new OrderDraft { Id = Guid.NewGuid(), BuyerUserId = buyerId, DeploymentId = deployment.Id, Buyer = Address(), Seller = Address(), Arbiter = Address(),
            AmountWei = "not-a-number", ClientReference = Hash(), TermsHash = Hash(), CreatedAt = DateTimeOffset.UtcNow };
        await using var db = Database();
        db.Add(new User(buyerId, $"{Guid.NewGuid():N}@example.test", "Risk Buyer", "hash", DateTimeOffset.UtcNow));
        db.AddRange(deployment, draft);
        await db.SaveChangesAsync();
        var result = await new RiskService(db, new NoModel(), TimeProvider.System, NullLogger<RiskService>.Instance).AssessAsync(draft.Id, default);
        Assert.Null(result.Score);
        Assert.Equal("unavailable", result.ScoringSource);
    }
}
