using Microsoft.EntityFrameworkCore;
using StudentEscrow.Domain.Orders;
using StudentEscrow.Infrastructure.Orders;
using StudentEscrow.Infrastructure.Persistence;
using Xunit;

namespace StudentEscrow.Application.Tests;

public sealed class SqlFactAttribute : FactAttribute
{
    public SqlFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("STUDENT_ESCROW_SQL_TEST_CONNECTION")))
            Skip = "Set STUDENT_ESCROW_SQL_TEST_CONNECTION to run against migrated SQL Server (no database reset).";
    }
}

public sealed class EscrowSqlTests
{
    private static StudentEscrowDbContext Database() => new(new DbContextOptionsBuilder<StudentEscrowDbContext>()
        .UseSqlServer(Environment.GetEnvironmentVariable("STUDENT_ESCROW_SQL_TEST_CONNECTION")).Options);

    [SqlFact]
    public async Task CheckpointRestartDedupReorgFailureAndDeploymentIsolationUseRealSqlTransactions()
    {
        var chain = new FakeChain();
        var manifest = new DeploymentManifest(Guid.NewGuid(), "31337", Fixtures.Contract, 1, Fixtures.Hash(1), Fixtures.Hash(101));
        var settings = new BlockchainSettings { BatchSize = 50 };
        async Task Sync(DeploymentManifest? m = null)
        {
            await using var db = Database();
            await new BlockchainSync(db, chain, settings, TimeProvider.System).SyncAsync(m ?? manifest, default);
        }
        async Task AssertState(string state, int eventCount, long checkpoint)
        {
            await using var db = Database();
            Assert.Equal(state, (await db.Set<ChainOrder>().SingleAsync(o => o.DeploymentId == manifest.DeploymentId)).State);
            Assert.Equal(eventCount, await db.Set<ChainEvent>().CountAsync(e => e.DeploymentId == manifest.DeploymentId));
            Assert.Equal(checkpoint, (await db.Set<ChainDeployment>().FindAsync(manifest.DeploymentId))!.LastBlock);
        }
        chain.Add(Fixtures.Created(1, Fixtures.Hash(1)));
        chain.Add(Fixtures.Deposited(2, Fixtures.Hash(2)));
        await Sync();
        await AssertState("Funded", 2, 2);
        await Sync(); // New DbContext simulates process restart; no duplicate journal entries.
        await AssertState("Funded", 2, 2);
        chain.Add(Fixtures.Delivered(3, Fixtures.Hash(3)));
        chain.Add(Fixtures.Released(4, Fixtures.Hash(4)));
        await Sync();
        await AssertState("Completed", 4, 4);
        chain.Logs.Remove(4);
        chain.Logs.Remove(3);
        chain.Add(Fixtures.Refunded(3, Fixtures.Hash(30)));
        await Sync();
        await AssertState("Refunded", 3, 3);
        await using (var db = Database())
            Assert.DoesNotContain(await db.Set<ChainEvent>().Where(e => e.DeploymentId == manifest.DeploymentId).ToListAsync(), e => e.Name == "Released");
        chain.Logs.Remove(3);
        await Sync(); // Shorter chain: unwind refund to Funded.
        await AssertState("Funded", 2, 2);
        chain.Add(Fixtures.Delivered(3, Fixtures.Hash(31)));
        chain.FailLogs = true;
        await Assert.ThrowsAsync<IOException>(() => Sync());
        await AssertState("Funded", 2, 2); // Failed batch never advances checkpoint.
        chain.FailLogs = false;
        await Sync();
        await AssertState("Delivered", 3, 3);
        await Sync(manifest with { DeploymentId = Guid.NewGuid() }); // Reused numeric order ID stays isolated.
        await AssertState("Delivered", 3, 3);
        chain.Valid = false;
        await Sync();
        await using (var db = Database())
            Assert.Equal("InvalidDeployment", (await db.Set<ChainDeployment>().FindAsync(manifest.DeploymentId))!.Status);
    }

    [SqlFact]
    public async Task DeploymentChangedBetweenValidationAndBlockReadDoesNotCommit()
    {
        var chain = new FakeChain();
        chain.Add(Fixtures.Created(1, Fixtures.Hash(123)));
        var manifest = new DeploymentManifest(Guid.NewGuid(), "31337", Fixtures.Contract, 1, Fixtures.Hash(1), Fixtures.Hash(101));
        await using (var db = Database())
            await Assert.ThrowsAsync<IOException>(() => new BlockchainSync(db, chain, new(), TimeProvider.System).SyncAsync(manifest, default));
        await using var check = Database();
        Assert.Null(await check.Set<ChainDeployment>().FindAsync(manifest.DeploymentId));
        Assert.Empty(await check.Set<ChainEvent>().Where(e => e.DeploymentId == manifest.DeploymentId).ToListAsync());
    }

    [SqlFact]
    public async Task ConfirmationDepthDefersUnconfirmedEvents()
    {
        var chain = new FakeChain();
        chain.Add(Fixtures.Created(1, Fixtures.Hash(1)));
        chain.Add(Fixtures.Deposited(2, Fixtures.Hash(2)));
        var manifest = new DeploymentManifest(Guid.NewGuid(), "31337", Fixtures.Contract, 1, Fixtures.Hash(1), Fixtures.Hash(101));
        await using var db = Database();
        await new BlockchainSync(db, chain, new() { Confirmations = 1 }, TimeProvider.System).SyncAsync(manifest, default);
        Assert.Equal("Created", (await db.Set<ChainOrder>().SingleAsync(o => o.DeploymentId == manifest.DeploymentId)).State);
        Assert.Equal(1, (await db.Set<ChainDeployment>().FindAsync(manifest.DeploymentId))!.LastBlock);
    }

    private sealed class FakeChain : IBlockchainSource
    {
        public Dictionary<long, RpcLog> Logs { get; } = [];
        public bool FailLogs { get; set; }
        public bool Valid { get; set; } = true;
        public void Add(RpcLog log) => Logs[log.BlockNumber] = log;
        public Task<long> HeadAsync(CancellationToken ct) => Task.FromResult(Logs.Keys.Max());
        public Task<RpcBlock?> BlockAsync(long number, CancellationToken ct) => Task.FromResult(Logs.TryGetValue(number, out var log)
            ? new RpcBlock(number, log.BlockHash, Logs.GetValueOrDefault(number - 1)?.BlockHash ?? Fixtures.Hash(0)) : null);
        public Task<bool> ValidateDeploymentAsync(DeploymentManifest manifest, CancellationToken ct) => Task.FromResult(Valid);
        public Task<IReadOnlyList<RpcLog>> LogsAsync(string address, long block, CancellationToken ct) => FailLogs
            ? throw new IOException("Simulated RPC failure") : Task.FromResult<IReadOnlyList<RpcLog>>([Logs[block]]);
    }
}
