using System.Numerics;
using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using StudentEscrow.Application.Common;
using StudentEscrow.Application.Wallets;
using StudentEscrow.Domain.Ledger;
using StudentEscrow.Domain.Users;
using StudentEscrow.Domain.Wallets;
using StudentEscrow.Infrastructure.Ledger;
using StudentEscrow.Infrastructure.Orders;
using StudentEscrow.Infrastructure.Persistence;
using StudentEscrow.Infrastructure.Wallets;
using Xunit;

namespace StudentEscrow.Application.Tests;

public sealed class CustodialWalletTests
{
    private static WalletKeyVault Vault() => new(RandomNumberGenerator.GetBytes(32));
    private const string Address = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";

    [Fact]
    public void KeyRoundTripsAndCiphertextDoesNotContainIt()
    {
        var vault = Vault();
        var user = Guid.NewGuid();
        var key = RandomNumberGenerator.GetBytes(32);
        var stored = vault.Protect(user, Address, key);
        Assert.False(stored.AsSpan().IndexOf(key) >= 0);
        Assert.Equal(key, vault.Unprotect(user, Address, stored));
        Assert.Equal(key, vault.Unprotect(user, Address.ToUpperInvariant().Replace("0X", "0x"), stored));
    }

    [Fact]
    public void CiphertextMovedToAnotherAccountOrTamperedCannotDecrypt()
    {
        var vault = Vault();
        var user = Guid.NewGuid();
        var stored = vault.Protect(user, Address, RandomNumberGenerator.GetBytes(32));
        Assert.ThrowsAny<CryptographicException>(() => vault.Unprotect(Guid.NewGuid(), Address, stored));
        Assert.ThrowsAny<CryptographicException>(() => vault.Unprotect(user, "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc", stored));
        Assert.ThrowsAny<CryptographicException>(() => Vault().Unprotect(user, Address, stored));
        var tampered = stored.ToArray();
        tampered[^1] ^= 1;
        Assert.ThrowsAny<CryptographicException>(() => vault.Unprotect(user, Address, tampered));
    }

    [Fact]
    public void MasterKeyMustBe32BytesAndIsOnlyGeneratedInDevelopment()
    {
        Assert.Throws<InvalidOperationException>(() => new WalletKeyVault(new byte[16]));
        var directory = Path.Combine(Path.GetTempPath(), "escrow-key-" + Guid.NewGuid().ToString("N"));
        var settings = new CustodialSettings { MasterKeyFile = Path.Combine(directory, "master.key") };
        Assert.Throws<InvalidOperationException>(() => WalletKeyVault.Load(settings, development: false));
        Assert.False(File.Exists(settings.MasterKeyFile));
        try
        {
            var user = Guid.NewGuid();
            var key = RandomNumberGenerator.GetBytes(32);
            var stored = WalletKeyVault.Load(settings, development: true).Protect(user, Address, key);
            // Reloading must reuse the file: a new key would strand every stored wallet.
            Assert.Equal(key, WalletKeyVault.Load(settings, development: true).Unprotect(user, Address, stored));
        }
        finally
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }
    }

    [Theory]
    [InlineData(0, "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266")]
    [InlineData(1, "0x70997970c51812dc3a010c7d01b50e0d17dc79c8")]
    [InlineData(2, "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc")]
    [InlineData(3, "0x90f79bf6eb2c4f870365e785982e1f101e93b906")]
    [InlineData(19, "0x8626f6940e2eb28930efb4cef49b2d1f2c9c1199")]
    public void HardhatKeysMatchTheAccountsAlreadyLinkedInTheDatabase(int index, string address)
    {
        Assert.Equal(address, HardhatKeys.Address(index));
        Assert.Equal(address, new Nethereum.Signer.EthECKey(HardhatKeys.PrivateKey(index), true).GetPublicAddress().ToLowerInvariant());
    }

    [Fact]
    public void FixedRateConvertsWithoutRounding()
    {
        Assert.Equal(1_000_000_000_000_000_000m, ExchangeRate.VndToWei(ExchangeRate.VndPerEth));
        Assert.Equal(10_000_000_000m, ExchangeRate.VndToWei(1));
        Assert.Equal(ExchangeRate.WeiPerVnd * ExchangeRate.VndPerEth, 1_000_000_000_000_000_000L);
        Assert.Equal("100000000", ExchangeRate.WeiToVnd(1_000_000_000_000_000_000m));
        Assert.Equal("0", ExchangeRate.WeiToVnd(9_999_999_999m));
        Assert.Equal("1000000000000000000", ExchangeRate.Format(1_000_000_000_000_000_000m));
    }

    [Fact]
    public void AbiEncodingMatchesKnownSelectorsAndWords()
    {
        Assert.Equal("0xb6b55f25" + new string('0', 63) + "7", EscrowCalls.Encode("deposit(uint256)", new BigInteger(7)));
        Assert.Equal("0xa9059cbb", EscrowCalls.Selector("transfer(address,uint256)"));
        var hash = "0x" + new string('a', 64);
        Assert.Equal("0x" + new string('0', 24) + "70997970c51812dc3a010c7d01b50e0d17dc79c8" + new string('a', 64) + new string('0', 63) + "1" + new string('0', 64),
            "0x" + EscrowCalls.Encode("f()", Address, hash, true, false)[10..]);
        Assert.Throws<ArgumentException>(() => EscrowCalls.Encode("f()", "not-hex"));
        Assert.Throws<ArgumentException>(() => EscrowCalls.Encode("f()", new BigInteger(-1)));
    }

    [Fact]
    public void WorkerIgnoresThePayoutBookkeepingEvents()
    {
        foreach (var signature in new[] { "PayoutDeferred(address,uint256)", "Withdrawn(address,address,uint256)" })
        {
            var log = new RpcLog(1, Fixtures.Hash(1), Fixtures.Hash(2), 0, Fixtures.Contract, [EscrowProjector.Topic(signature)], "0x", false);
            Assert.Null(EscrowProjector.Decode(Guid.NewGuid(), log));
        }
    }
}

[Collection("Sql")]
public sealed class LedgerSqlTests
{
    private static StudentEscrowDbContext Database() => new(new DbContextOptionsBuilder<StudentEscrowDbContext>()
        .UseSqlServer(Environment.GetEnvironmentVariable("STUDENT_ESCROW_SQL_TEST_CONNECTION")).Options);

    private static async Task<Guid> NewUser()
    {
        var id = Guid.NewGuid();
        await using var db = Database();
        db.Add(new User(id, $"ledger.{id:N}@example.test", "Ledger Test", "x", DateTimeOffset.UtcNow, usesExternalWallet: true));
        await db.SaveChangesAsync();
        return id;
    }

    private static async Task<decimal> Balance(Guid user)
    {
        await using var db = Database();
        return await db.LedgerAccounts.Where(item => item.UserId == user).Select(item => item.BalanceWei).SingleAsync();
    }

    private static async Task<LedgerEntry?> Post(LedgerPosting posting)
    {
        await using var db = Database();
        return await new LedgerService(db, TimeProvider.System).PostAsync(posting, default);
    }

    [SqlFact]
    public async Task PostingIsIdempotentAndCannotOverdraw()
    {
        var user = await NewUser();
        var key = "test-credit:" + Guid.NewGuid().ToString("N");
        Assert.NotNull(await Post(new(user, LedgerEntryType.AdminCredit, 5000m, key)));
        Assert.Null(await Post(new(user, LedgerEntryType.AdminCredit, 5000m, key)));
        Assert.Equal(5000m, await Balance(user));

        var error = await Assert.ThrowsAsync<ApplicationError>(() => Post(new(user, LedgerEntryType.EscrowHold, -5001m, "test-hold:" + Guid.NewGuid())));
        Assert.Equal("INSUFFICIENT_BALANCE", error.Code);
        Assert.Equal(5000m, await Balance(user));

        await using var db = Database();
        Assert.Equal(1, await db.LedgerEntries.CountAsync(item => item.UserId == user));
    }

    [SqlFact]
    public async Task ConcurrentHoldsCannotSpendTheSameBalanceTwice()
    {
        var user = await NewUser();
        await Post(new(user, LedgerEntryType.AdminCredit, 1000m, "test-credit:" + Guid.NewGuid().ToString("N")));
        var attempts = Enumerable.Range(0, 6).Select(_ => Task.Run(async () =>
        {
            try { return await Post(new(user, LedgerEntryType.EscrowHold, -400m, "test-hold:" + Guid.NewGuid().ToString("N"))) is not null; }
            catch (ApplicationError) { return false; }
        }));
        Assert.Equal(2, (await Task.WhenAll(attempts)).Count(success => success));
        Assert.Equal(200m, await Balance(user));
    }

    [SqlFact]
    public async Task ReleasedHoldRestoresBalanceAndCanBeRetried()
    {
        var user = await NewUser();
        await Post(new(user, LedgerEntryType.AdminCredit, 1000m, "test-credit:" + Guid.NewGuid().ToString("N")));
        var key = "escrow-hold:" + Guid.NewGuid().ToString("N");
        var hold = await Post(new(user, LedgerEntryType.EscrowHold, -600m, key));
        Assert.Equal(400m, await Balance(user));
        Assert.Null(await Post(new(user, LedgerEntryType.EscrowHold, -600m, key)));
        await using (var db = Database()) await new LedgerService(db, TimeProvider.System).ReleaseHoldAsync(hold!, "test", default);
        Assert.Equal(1000m, await Balance(user));
        Assert.NotNull(await Post(new(user, LedgerEntryType.EscrowHold, -600m, key)));
        Assert.Equal(400m, await Balance(user));
    }

    [SqlFact]
    public async Task SettlementCreditsPartiesOnceAndReorgReversesThem()
    {
        var (buyer, seller) = (await NewUser(), await NewUser());
        var key = new byte[] { 1 };
        await using (var db = Database())
        {
            await db.CustodialWallets.Where(item => item.Address == Fixtures.Buyer || item.Address == Fixtures.Seller).ExecuteDeleteAsync();
            db.Add(new CustodialWallet(buyer, Fixtures.Buyer, key, CustodialWallet.Generated, DateTimeOffset.UtcNow));
            db.Add(new CustodialWallet(seller, Fixtures.Seller, key, CustodialWallet.Generated, DateTimeOffset.UtcNow));
            await db.SaveChangesAsync();
        }
        try
        {
            var chain = new EscrowSqlTests.FakeChain();
            var manifest = new DeploymentManifest(Guid.NewGuid(), "31337", Fixtures.Contract, 1, Fixtures.Hash(1), Fixtures.Hash(101));
            async Task Sync()
            {
                await using var db = Database();
                await new BlockchainSync(db, chain, new BlockchainSettings { BatchSize = 50 }, TimeProvider.System).SyncAsync(manifest, default);
            }
            chain.Add(Fixtures.Created(1, Fixtures.Hash(1)));
            chain.Add(Fixtures.Accepted(2, Fixtures.Hash(2)));
            chain.Add(Fixtures.Deposited(3, Fixtures.Hash(3)));
            chain.Add(Fixtures.Delivered(4, Fixtures.Hash(4)));
            chain.Add(Fixtures.Released(5, Fixtures.Hash(5)));
            await Sync();
            Assert.Equal(990m, await Balance(seller));
            await Sync(); // Restart must not credit again.
            Assert.Equal(990m, await Balance(seller));

            chain.Logs.Remove(5);
            chain.Logs.Remove(4);
            chain.Add(Fixtures.Refunded(4, Fixtures.Hash(30)));
            await Sync();
            Assert.Equal(0m, await Balance(seller));
            Assert.Equal(1000m, await Balance(buyer));
            await using var check = Database();
            Assert.Single(await check.LedgerEntries.Where(item => item.UserId == seller && item.Type == LedgerEntryType.ChainReversal).ToListAsync());
        }
        finally
        {
            await using var db = Database();
            await db.CustodialWallets.Where(item => item.UserId == buyer || item.UserId == seller).ExecuteDeleteAsync();
        }
    }

    [SqlFact]
    public async Task ReplacingTheLocalChainReturnsUnsettledHoldsOnly()
    {
        var user = await NewUser();
        var settled = Guid.NewGuid().ToString("N");
        var oldDeployment = Guid.NewGuid();
        await Post(new(user, LedgerEntryType.AdminCredit, 1000m, "test-credit:" + Guid.NewGuid().ToString("N")));
        await Post(new(user, LedgerEntryType.EscrowHold, -300m, "escrow-hold:" + settled, oldDeployment, "1"));
        Assert.Equal(700m, await Balance(user));

        var chain = new EscrowSqlTests.FakeChain();
        chain.Add(Fixtures.Created(1, Fixtures.Hash(1)));
        var manifest = new DeploymentManifest(Guid.NewGuid(), "31337", Fixtures.Contract, 1, Fixtures.Hash(1), Fixtures.Hash(101));
        for (var run = 0; run < 2; run++)
        {
            await using var db = Database();
            await new BlockchainSync(db, chain, new BlockchainSettings { BatchSize = 50 }, TimeProvider.System).SyncAsync(manifest, default);
        }
        Assert.Equal(1000m, await Balance(user));
    }
}
