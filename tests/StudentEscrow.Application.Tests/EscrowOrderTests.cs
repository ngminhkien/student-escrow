using System.IO.Compression;
using System.Text;
using StudentEscrow.Application.Common;
using StudentEscrow.Application.Orders;
using StudentEscrow.Domain.Orders;
using StudentEscrow.Infrastructure.Orders;
using Xunit;

namespace StudentEscrow.Application.Tests;

public sealed class EscrowOrderTests
{
    [Theory]
    [InlineData("0")]
    [InlineData("-1")]
    [InlineData("1.5")]
    [InlineData("01")]
    [InlineData("100000000000000000000000000000000000000")]
    public void RejectsNoncanonicalOrOutOfRangeWei(string amount) => Assert.Throws<ApplicationError>(() =>
        OrderRules.Validate(new() { Description = "Landing page", AcceptanceCriteria = "375/1440 px", AmountWei = amount,
            DeliveryDeadline = 200, ReviewWindow = 300 }, 100));

    [Fact]
    public void TermsHashCoversIdentityAndEveryAgreedField()
    {
        var draft = new OrderDraft { DeploymentId = Guid.NewGuid(), Buyer = Fixtures.Buyer, Seller = Fixtures.Seller,
            Arbiter = Fixtures.Arbiter, Description = "Tiếng Việt\nLanding page", AmountWei = "1000", ReviewWindow = 300 };
        OrderRules.Seal(draft, 31337, Fixtures.Contract);
        var hash = draft.TermsHash;
        Assert.Equal(OrderRules.Hash(Encoding.UTF8.GetBytes(draft.TermsJson)), hash);
        OrderRules.Seal(draft, 31337, Fixtures.Contract);
        Assert.Equal(hash, draft.TermsHash);
        draft.AcceptanceCriteria = "New terms";
        OrderRules.Seal(draft, 31337, Fixtures.Contract);
        Assert.NotEqual(hash, draft.TermsHash);
    }

    [Fact]
    public async Task ZipBytesArePreservedAndHashChangesWithContent()
    {
        var bytes = Zip("index.html", "<h1>Hello</h1>");
        Assert.Equal(bytes, await OrderRules.ReadFileAsync(new MemoryStream(bytes), "product", "demo.zip", default));
        Assert.NotEqual(OrderRules.Hash(bytes), OrderRules.Hash(Zip("index.html", "Changed")));
    }

    [Theory]
    [InlineData("product", "fake.zip", "not a ZIP")]
    [InlineData("product", "fake.html", "<html></html>")]
    [InlineData("evidence", "fake.pdf", "not a PDF")]
    [InlineData("evidence", "fake.png", "not a PNG")]
    [InlineData("evidence", "fake.jpg", "not a JPEG")]
    [InlineData("anything", "file.zip", "fake")]
    public async Task RejectsSpoofedFiles(string kind, string name, string content) =>
        await Assert.ThrowsAsync<ApplicationError>(() => OrderRules.ReadFileAsync(new MemoryStream(Encoding.UTF8.GetBytes(content)), kind, name, default));

    [Fact]
    public async Task RejectsEmptyTraversalAndOversizedFiles()
    {
        await Assert.ThrowsAsync<ApplicationError>(() => OrderRules.ReadFileAsync(new MemoryStream(), "product", "empty.zip", default));
        await Assert.ThrowsAsync<ApplicationError>(() => OrderRules.ReadFileAsync(new MemoryStream(Zip("../x", "bad")), "product", "bad.zip", default));
        var error = await Assert.ThrowsAsync<ApplicationError>(() => OrderRules.ReadFileAsync(
            new MemoryStream(new byte[5_000_001]), "evidence", "large.pdf", default));
        Assert.Equal(413, error.StatusCode);
    }

    [Fact]
    public void QuotasCountBothPartiesAndPreventProductReplacement()
    {
        Assert.Throws<ApplicationError>(() => OrderRules.CheckQuota([("product", 1)], "product", 1));
        Assert.Throws<ApplicationError>(() => OrderRules.CheckQuota(Enumerable.Repeat(("evidence", 1L), 5), "evidence", 1));
        Assert.Throws<ApplicationError>(() => OrderRules.CheckQuota([("product", 50_000_000), ("evidence", 25_000_000)], "evidence", 1));
        OrderRules.CheckQuota([("product", 50_000_000), ("evidence", 20_000_000)], "evidence", 5_000_000);
    }

    [Fact]
    public void ReferenceAloneCannotAttachIncorrectOnChainTerms()
    {
        var dep = Guid.NewGuid();
        var order = EscrowProjector.Apply(EscrowProjector.Decode(dep, Fixtures.Created(1, Fixtures.Hash(1)))!, null);
        var draft = new OrderDraft { DeploymentId = dep, Buyer = order.Buyer, Seller = order.Seller, Arbiter = order.Arbiter,
            ClientReference = order.ClientReference, AmountWei = order.AmountWei, TermsHash = order.TermsHash,
            DeliveryDeadline = order.DeliveryDeadline, ReviewWindow = order.ReviewWindow };
        Assert.True(OrderRules.Matches(draft, order));
        draft.AmountWei = "999";
        Assert.False(OrderRules.Matches(draft, order));
    }

    [Fact]
    public void DecodeAndProjectChecksLifecycleAndWeiConservation()
    {
        var dep = Guid.NewGuid();
        var order = EscrowProjector.Apply(EscrowProjector.Decode(dep, Fixtures.Created(1, Fixtures.Hash(1)))!, null);
        Assert.Equal(Fixtures.Seller, order.Seller);
        Assert.Equal("1000", order.AmountWei);
        Assert.Equal("Created", order.State);
        void Apply(RpcLog log) => EscrowProjector.Apply(EscrowProjector.Decode(dep, log)!, order);
        Assert.Throws<InvalidDataException>(() => Apply(Fixtures.Delivered(2, Fixtures.Hash(2))));
        Apply(Fixtures.Deposited(2, Fixtures.Hash(2)));
        Apply(Fixtures.Delivered(3, Fixtures.Hash(3)));
        Apply(Fixtures.Released(4, Fixtures.Hash(4)));
        Assert.Equal("Completed", order.State);
        Assert.Equal("990", order.SellerNetWei);
        Assert.Equal("10", order.PlatformFeeWei);
        Assert.Throws<InvalidDataException>(() => Apply(Fixtures.Released(5, Fixtures.Hash(5))));
    }

    [Fact]
    public void StructuralEvidenceChecksRejectTruncatedAndMarkerOnlyContent()
    {
        var png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII=");
        Assert.True(EvidenceFormat.IsPng(png));
        Assert.False(EvidenceFormat.IsPng(png[..^1]));
        Assert.False(EvidenceFormat.IsPng(png[..33]));
        Assert.False(EvidenceFormat.IsJpeg([255, 216, 255, 217]));
        Assert.False(EvidenceFormat.IsPdf(Encoding.ASCII.GetBytes("%PDF-1.7\nnot a document\n%%EOF")));
    }

    [Fact]
    public void RejectsMalformedKnownEvent()
    {
        var log = Fixtures.Created(1, Fixtures.Hash(1));
        Assert.Throws<InvalidDataException>(() => EscrowProjector.Decode(Guid.NewGuid(), log with { Data = "0x00" }));
        Assert.Throws<InvalidDataException>(() => EscrowProjector.Decode(Guid.NewGuid(), log with { Removed = true }));
    }

    internal static byte[] Zip(string name, string content)
    {
        using var stream = new MemoryStream();
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        using (var writer = new StreamWriter(zip.CreateEntry(name).Open())) writer.Write(content);
        return stream.ToArray();
    }
}

internal static class Fixtures
{
    public const string Buyer = "0x1111111111111111111111111111111111111111";
    public const string Seller = "0x2222222222222222222222222222222222222222";
    public const string Arbiter = "0x3333333333333333333333333333333333333333";
    public const string Contract = "0x4444444444444444444444444444444444444444";
    public static string Hash(int n) => "0x" + n.ToString("x64");
    private static string Address(string address) => address[2..].PadLeft(64, '0');
    private static string Word(int n) => n.ToString("x64");
    public static RpcLog Created(long block, string hash) => new(block, hash, Hash(100 + (int)block), 0, Contract,
        [EscrowProjector.Topic("OrderCreated(uint256,bytes32,address,address,address,uint256,uint256,bytes32,uint256,uint256)"), Hash(1), Hash(99), "0x" + Address(Buyer)],
        "0x" + Address(Seller) + Address(Arbiter) + Word(1000) + Word(100) + Word(77) + Word(2000000000) + Word(300), false);
    private static RpcLog Event(string signature, long block, string hash, params int[] words) => new(block, hash,
        Hash(100 + (int)block), 0, Contract, [EscrowProjector.Topic(signature), Hash(1)], "0x" + string.Concat(words.Select(Word)), false);
    public static RpcLog Deposited(long block, string hash) => Event("Deposited(uint256,uint256)", block, hash, 1000);
    public static RpcLog Delivered(long block, string hash) => Event("Delivered(uint256,bytes32,uint256,uint256)", block, hash, 55, 1000, 1300);
    public static RpcLog Released(long block, string hash) => Event("Released(uint256,uint256,uint256,uint256)", block, hash, 1000, 990, 10);
    public static RpcLog Refunded(long block, string hash) => Event("Refunded(uint256,uint256)", block, hash, 1000);
}
