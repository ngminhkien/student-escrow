using Microsoft.EntityFrameworkCore;
using StudentEscrow.Application.Common;
using StudentEscrow.Application.Orders;
using StudentEscrow.Domain.Orders;
using StudentEscrow.Domain.Users;
using StudentEscrow.Domain.Wallets;
using StudentEscrow.Infrastructure.Orders;
using StudentEscrow.Infrastructure.Persistence;
using Xunit;

namespace StudentEscrow.Application.Tests;

public sealed class ChatRulesTests
{
    [Theory]
    [InlineData("Buyer", "Draft", true, true)]
    [InlineData("Seller", "Created", true, true)]
    [InlineData("Buyer", "Funded", true, true)]
    [InlineData("Seller", "Disputed", true, true)]
    [InlineData("Buyer", "Completed", true, false)]
    [InlineData("Seller", "Refunded", true, false)]
    [InlineData("Buyer", "Cancelled", true, false)]
    [InlineData("Seller", "Resolved", true, false)]
    [InlineData("Arbiter", "Draft", false, false)]
    [InlineData("Arbiter", "Funded", false, false)]
    [InlineData("Arbiter", "Delivered", false, false)]
    [InlineData("Arbiter", "Completed", false, false)]
    [InlineData("Arbiter", "Disputed", true, true)]
    [InlineData("Arbiter", "Resolved", true, false)]
    public void AccessFollowsTheRoleAndTheOrderState(string role, string state, bool read, bool send)
    {
        Assert.Equal(read, ChatRules.CanRead(role, state));
        Assert.Equal(send, ChatRules.CanSend(role, state));
    }
}

[Collection("Sql")]
public sealed class ChatSqlTests
{
    private static StudentEscrowDbContext Database() => new(new DbContextOptionsBuilder<StudentEscrowDbContext>()
        .UseSqlServer(Environment.GetEnvironmentVariable("STUDENT_ESCROW_SQL_TEST_CONNECTION")).Options);
    private static string Address() => "0x" + Guid.NewGuid().ToString("N") + "00000000";
    private static string Hash() => "0x" + Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N");
    private static ChatService Service(StudentEscrowDbContext db)
    {
        var settings = new BlockchainSettings { Enabled = false };
        return new ChatService(db, new ManifestProvider(settings), settings, TimeProvider.System);
    }

    private sealed record Fixture(Guid Id, Guid Deployment, string Buyer, string Reference, Guid BuyerId, Guid SellerId, Guid ArbiterId, Guid OutsiderId);

    private static async Task<Fixture> OrderAsync(string? state)
    {
        var now = DateTimeOffset.UtcNow;
        var (buyer, seller, arbiter, reference) = (Address(), Address(), Address(), Hash());
        var (buyerId, sellerId, arbiterId, outsiderId) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        var deployment = new ChainDeployment { Id = Guid.NewGuid(), ChainId = 31337, ContractAddress = Address(), DeploymentBlock = 1,
            DeploymentBlockHash = Hash(), TransactionHash = Hash(), LastBlock = 1, LastBlockHash = Hash(), Status = "Ready" };
        var draft = new OrderDraft { Id = Guid.NewGuid(), BuyerUserId = buyerId, DeploymentId = deployment.Id, Buyer = buyer, Seller = seller, Arbiter = arbiter,
            AmountWei = "1000", ClientReference = reference, TermsHash = Hash(), CreatedAt = now };
        await using var db = Database();
        foreach (var (id, address) in new[] { (buyerId, buyer), (sellerId, seller), (arbiterId, arbiter), (outsiderId, Address()) })
        {
            db.Add(new User(id, $"{Guid.NewGuid():N}@example.test", "Chat Test", "hash", now));
            db.Add(new WalletLink(Guid.NewGuid(), id, address, 31337, now));
        }
        db.AddRange(deployment, draft);
        if (state is not null)
            db.Add(new ChainOrder { DeploymentId = deployment.Id, OrderId = "1", ClientReference = reference, Buyer = buyer, Seller = seller, Arbiter = arbiter,
                AmountWei = "1000", TermsHash = Hash(), State = state });
        await db.SaveChangesAsync();
        return new Fixture(draft.Id, deployment.Id, buyer, reference, buyerId, sellerId, arbiterId, outsiderId);
    }

    private static async Task SetStateAsync(Fixture order, string state)
    {
        await using var db = Database();
        await db.Set<ChainOrder>().Where(item => item.DeploymentId == order.Deployment && item.ClientReference == order.Reference)
            .ExecuteUpdateAsync(set => set.SetProperty(item => item.State, state));
    }

    private static async Task<ApplicationError> FailsAsync(Func<Task> action) => await Assert.ThrowsAsync<ApplicationError>(action);

    [SqlFact]
    public async Task PartiesTalkAndOutsidersGetNotFound()
    {
        var order = await OrderAsync("Created");
        await using var db = Database();
        var chat = Service(db);
        var sent = await chat.SendAsync(order.BuyerId, order.Id, new SendChatMessageRequest { Text = "  Xin chào  " }, default);
        Assert.Equal(1, sent.Seq);
        Assert.Equal("Xin chào", sent.Text);
        await chat.SendAsync(order.SellerId, order.Id, new SendChatMessageRequest { Text = "Chào bạn" }, default);

        var page = await chat.ReadAsync(order.SellerId, order.Id, null, null, default);
        Assert.Equal(["Xin chào", "Chào bạn"], page.Messages.Select(item => item.Text));
        Assert.Equal([false, true], page.Messages.Select(item => item.Mine));
        Assert.Equal(["Buyer", "Seller"], page.Messages.Select(item => item.SenderRole));
        Assert.Equal(2, page.LatestSeq);
        Assert.Equal("Seller", page.Role);
        Assert.True(page.CanSend);

        Assert.Single((await chat.ReadAsync(order.BuyerId, order.Id, 1, null, default)).Messages);
        Assert.Empty((await chat.ReadAsync(order.BuyerId, order.Id, 2, null, default)).Messages);

        Assert.Equal("ORDER_NOT_FOUND", (await FailsAsync(() => chat.ReadAsync(order.OutsiderId, order.Id, null, null, default))).Code);
        Assert.Equal("ORDER_NOT_FOUND", (await FailsAsync(() => chat.SendAsync(order.OutsiderId, order.Id, new SendChatMessageRequest { Text = "x" }, default))).Code);
        Assert.Equal("ORDER_NOT_FOUND", (await FailsAsync(() => chat.MarkReadAsync(order.OutsiderId, order.Id, 1, default))).Code);
    }

    [SqlFact]
    public async Task ArbiterIsKeptOutUntilADisputeAndFinishedOrdersAreReadOnly()
    {
        var order = await OrderAsync("Funded");
        await using var db = Database();
        var chat = Service(db);
        await chat.SendAsync(order.BuyerId, order.Id, new SendChatMessageRequest { Text = "Riêng tư" }, default);
        Assert.Equal("CHAT_NOT_OPEN", (await FailsAsync(() => chat.ReadAsync(order.ArbiterId, order.Id, null, null, default))).Code);
        Assert.DoesNotContain(await chat.UnreadAsync(order.ArbiterId, default), item => item.DraftId == order.Id);

        await SetStateAsync(order, "Disputed");
        Assert.Single((await chat.ReadAsync(order.ArbiterId, order.Id, null, null, default)).Messages);
        Assert.Contains(await chat.UnreadAsync(order.ArbiterId, default), item => item.DraftId == order.Id && item.Count == 1);
        Assert.Equal("Arbiter", (await chat.SendAsync(order.ArbiterId, order.Id, new SendChatMessageRequest { Text = "Tôi đã vào" }, default)).SenderRole);

        await SetStateAsync(order, "Resolved");
        var page = await chat.ReadAsync(order.ArbiterId, order.Id, null, null, default);
        Assert.False(page.CanSend);
        Assert.Equal(2, page.Messages.Count);
        Assert.Equal("CHAT_READ_ONLY", (await FailsAsync(() => chat.SendAsync(order.BuyerId, order.Id, new SendChatMessageRequest { Text = "x" }, default))).Code);
    }

    [SqlFact]
    public async Task RejectsEmptyAndOverlongTextAndAFileThatIsNotYourEvidence()
    {
        var order = await OrderAsync("Funded");
        var (product, sellerEvidence, own) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        await using var db = Database();
        db.AddRange(
            new OrderFile { Id = product, DraftId = order.Id, UploadedBy = order.BuyerId, Kind = "product", FileName = "a.zip", Sha256 = Hash(), Length = 3, Content = [1, 2, 3], CreatedAt = DateTimeOffset.UtcNow },
            new OrderFile { Id = sellerEvidence, DraftId = order.Id, UploadedBy = order.SellerId, Kind = "evidence", FileName = "s.png", Sha256 = Hash(), Length = 3, Content = [1, 2, 3], CreatedAt = DateTimeOffset.UtcNow },
            new OrderFile { Id = own, DraftId = order.Id, UploadedBy = order.BuyerId, Kind = "evidence", FileName = "b.png", Sha256 = Hash(), Length = 3, Content = [1, 2, 3], CreatedAt = DateTimeOffset.UtcNow });
        await db.SaveChangesAsync();
        var chat = Service(db);
        Assert.Equal("CHAT_EMPTY", (await FailsAsync(() => chat.SendAsync(order.BuyerId, order.Id, new SendChatMessageRequest { Text = "   " }, default))).Code);
        Assert.Equal("CHAT_TOO_LONG", (await FailsAsync(() => chat.SendAsync(order.BuyerId, order.Id, new SendChatMessageRequest { Text = new string('a', 2001) }, default))).Code);
        foreach (var bad in new[] { product, sellerEvidence, Guid.NewGuid() })
            Assert.Equal("CHAT_FILE_INVALID", (await FailsAsync(() => chat.SendAsync(order.BuyerId, order.Id, new SendChatMessageRequest { FileId = bad }, default))).Code);

        await chat.SendAsync(order.BuyerId, order.Id, new SendChatMessageRequest { FileId = own }, default);
        var message = Assert.Single((await chat.ReadAsync(order.SellerId, order.Id, null, null, default)).Messages);
        Assert.Equal("b.png", message.File!.FileName);
        Assert.Equal(3, message.File.Length);
    }

    // Readers use Seq as a cursor, so a gap or a late lower number would lose a message for good.
    [SqlFact]
    public async Task ConcurrentSendsGetGaplessNumbersAndPagesCoverEverything()
    {
        var order = await OrderAsync("Created");
        await Task.WhenAll(Enumerable.Range(1, 30).Select(async index =>
        {
            await using var db = Database();
            await Service(db).SendAsync(index % 2 == 0 ? order.BuyerId : order.SellerId, order.Id, new SendChatMessageRequest { Text = index.ToString() }, default);
        }));
        await using var check = Database();
        var chat = Service(check);
        var page = await chat.ReadAsync(order.BuyerId, order.Id, 0, null, default);
        Assert.Equal(Enumerable.Range(1, 30).Select(value => (long)value), page.Messages.Select(item => item.Seq));
        Assert.Equal(30, page.Messages.Select(item => item.Text).Distinct().Count());

        var rows = Enumerable.Range(31, 120).Select(seq => new ChatMessage { DraftId = order.Id, Seq = seq, SenderUserId = order.BuyerId, SenderRole = "Buyer", Text = "x", CreatedAt = DateTimeOffset.UtcNow });
        check.AddRange(rows);
        await check.SaveChangesAsync();
        var newest = await chat.ReadAsync(order.BuyerId, order.Id, null, null, default);
        Assert.Equal(51, newest.Messages[0].Seq);
        Assert.Equal(150, newest.Messages[^1].Seq);
        Assert.Equal(150, newest.LatestSeq);
        var older = await chat.ReadAsync(order.BuyerId, order.Id, null, 51, default);
        Assert.Equal(Enumerable.Range(1, 50).Select(value => (long)value), older.Messages.Select(item => item.Seq));
        var forward = await chat.ReadAsync(order.BuyerId, order.Id, 10, null, default);
        Assert.Equal(11, forward.Messages[0].Seq);
        Assert.Equal(110, forward.Messages[^1].Seq);
    }

    [SqlFact]
    public async Task UnreadCountsOnlyTheOtherSidesNewMessagesAndNeverMovesBack()
    {
        var order = await OrderAsync("Created");
        await using var db = Database();
        var chat = Service(db);
        async Task<int?> Unread(Guid user) => (await chat.UnreadAsync(user, default)).FirstOrDefault(item => item.DraftId == order.Id)?.Count;
        foreach (var text in new[] { "1", "2", "3" }) await chat.SendAsync(order.BuyerId, order.Id, new SendChatMessageRequest { Text = text }, default);
        Assert.Equal(3, await Unread(order.SellerId));
        Assert.Null(await Unread(order.BuyerId));
        await chat.MarkReadAsync(order.SellerId, order.Id, 2, default);
        Assert.Equal(1, await Unread(order.SellerId));
        await chat.MarkReadAsync(order.SellerId, order.Id, 1, default);
        Assert.Equal(1, await Unread(order.SellerId));
        await chat.MarkReadAsync(order.SellerId, order.Id, 999, default);
        Assert.Null(await Unread(order.SellerId));
        await chat.SendAsync(order.BuyerId, order.Id, new SendChatMessageRequest { Text = "4" }, default);
        Assert.Equal(1, await Unread(order.SellerId));
    }

    [SqlFact]
    public async Task SystemEventsComeFromTheChainJournalAndMessagesAreAnchoredToTheSyncedBlock()
    {
        var order = await OrderAsync("Funded");
        await using var db = Database();
        // A local chain's clock can be far ahead of the wall clock, and that must not reorder the thread.
        var at = DateTimeOffset.UtcNow.AddDays(30).ToUnixTimeSeconds();
        foreach (var (number, name) in new[] { (11L, "Deposited"), (10L, "OrderCreated") })
        {
            var hash = Hash();
            db.Add(new ChainBlock { DeploymentId = order.Deployment, Number = number, Hash = hash, Timestamp = at + number });
            db.Add(new ChainEvent { DeploymentId = order.Deployment, TransactionHash = Hash(), LogIndex = 0, BlockNumber = number, BlockHash = hash, Name = name, OrderId = "1", Payload = "{}" });
        }
        await db.SaveChangesAsync();
        var page = await Service(db).ReadAsync(order.BuyerId, order.Id, null, null, default);
        Assert.Equal(["OrderCreated", "Deposited"], page.Events.Select(item => item.Name));
        Assert.Equal([10L, 11L], page.Events.Select(item => item.BlockNumber));

        async Task<long> SyncedAtAndSend(long block)
        {
            await db.Set<ChainDeployment>().Where(item => item.Id == order.Deployment).ExecuteUpdateAsync(set => set.SetProperty(item => item.LastBlock, block));
            return (await Service(db).SendAsync(order.BuyerId, order.Id, new SendChatMessageRequest { Text = "x" }, default)).ChainBlock;
        }
        Assert.Equal(11, await SyncedAtAndSend(11));
        Assert.Equal(12, await SyncedAtAndSend(12));
        // A chain reorganisation can lower the synced block, but the thread must keep its order.
        Assert.Equal(12, await SyncedAtAndSend(5));
    }
}
