using System.Numerics;
using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using StudentEscrow.Application.Common;
using StudentEscrow.Application.Wallets;
using StudentEscrow.Domain.Ledger;
using StudentEscrow.Domain.Users;
using StudentEscrow.Domain.Wallets;
using StudentEscrow.Infrastructure.Ledger;
using StudentEscrow.Infrastructure.Payments;
using StudentEscrow.Infrastructure.Persistence;
using StudentEscrow.Infrastructure.Wallets;
using Xunit;

namespace StudentEscrow.Application.Tests;

public sealed class PaymentSignerTests
{
    private static readonly PaymentSigner Signer = new(RandomNumberGenerator.GetBytes(32));
    private static readonly Guid Deposit = Guid.NewGuid();
    private const long Time = 1_800_000_000;

    [Fact]
    public void SignatureCoversEveryFieldThatDecidesMoney()
    {
        var signature = Signer.Sign(Deposit, 100_000, "Succeeded", "TX-1", Time);
        Assert.Matches("^[0-9a-f]{64}$", signature);
        Assert.True(Signer.Verify(Deposit, 100_000, "Succeeded", "TX-1", Time, signature));
        Assert.False(Signer.Verify(Guid.NewGuid(), 100_000, "Succeeded", "TX-1", Time, signature));
        Assert.False(Signer.Verify(Deposit, 100_001, "Succeeded", "TX-1", Time, signature));
        Assert.False(Signer.Verify(Deposit, 100_000, "Failed", "TX-1", Time, signature));
        Assert.False(Signer.Verify(Deposit, 100_000, "Succeeded", "TX-2", Time, signature));
        Assert.False(Signer.Verify(Deposit, 100_000, "Succeeded", "TX-1", Time + 1, signature));
        Assert.False(Signer.Verify(Deposit, 100_000, "Succeeded", "TX-1", Time, signature[..^1]));
    }

    [Fact]
    public void AnotherSecretCannotForgeASignature()
    {
        var forged = new PaymentSigner(RandomNumberGenerator.GetBytes(32)).Sign(Deposit, 100_000, "Succeeded", "TX-1", Time);
        Assert.False(Signer.Verify(Deposit, 100_000, "Succeeded", "TX-1", Time, forged));
    }

    [Fact]
    public void WeakOrMissingSecretIsRefused()
    {
        Assert.Throws<InvalidOperationException>(() => new PaymentSigner(new byte[31]));
        Assert.Throws<InvalidOperationException>(() => PaymentSigner.Load(new PaymentSettings(), development: false));
        Assert.Throws<InvalidOperationException>(() => PaymentSigner.Load(new PaymentSettings { WebhookSecret = "not base64!" }, development: false));
    }

    [Fact]
    public void DevelopmentCreatesTheSecretOnceAndKeepsIt()
    {
        var folder = Path.Combine(Path.GetTempPath(), "escrow-" + Guid.NewGuid().ToString("N"));
        try
        {
            var settings = new PaymentSettings { WebhookSecretFile = Path.Combine(folder, "nested", "payment.key") };
            var first = PaymentSigner.Load(settings, development: true);
            var second = PaymentSigner.Load(settings, development: true);
            Assert.True(second.Verify(Deposit, 1, "Failed", "TX", Time, first.Sign(Deposit, 1, "Failed", "TX", Time)));
        }
        finally { if (Directory.Exists(folder)) Directory.Delete(folder, recursive: true); }
    }
}

[Collection("Sql")]
public sealed class DepositSqlTests
{
    private static readonly PaymentSigner Signer = new(RandomNumberGenerator.GetBytes(32));

    private sealed class Clock(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = now;
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private sealed class RecordingChain : IChainGateway
    {
        public List<(string From, string To, BigInteger Value)> Sent { get; } = [];
        public Exception? Failure { get; set; }
        public Task<BigInteger> BalanceAsync(string address, CancellationToken ct) => Task.FromResult(BigInteger.Zero);
        public Task<string> CallAsync(string to, string data, CancellationToken ct) => Task.FromResult("0x");
        public Task<string> SendAsync(byte[] privateKey, string from, string to, BigInteger value, string data, CancellationToken ct)
        {
            if (Failure is not null) throw Failure;
            lock (Sent) Sent.Add((from, to, value));
            return Task.FromResult("0x" + new string('a', 64));
        }
    }

    private static StudentEscrowDbContext Database() => new(new DbContextOptionsBuilder<StudentEscrowDbContext>()
        .UseSqlServer(Environment.GetEnvironmentVariable("STUDENT_ESCROW_SQL_TEST_CONNECTION")).Options);

    private static DepositService Service(StudentEscrowDbContext db, TimeProvider? clock = null, bool enabled = true, IChainGateway? chain = null)
    {
        var time = clock ?? TimeProvider.System;
        return new DepositService(db, new LedgerService(db, time), chain ?? new RecordingChain(), new PaymentSettings { MockEnabled = enabled }, Signer, time, NullLogger<DepositService>.Instance);
    }

    private static async Task<Guid> NewUser(bool custodial = true, long chainId = 31337)
    {
        var id = Guid.NewGuid();
        await using var db = Database();
        db.Add(new User(id, $"deposit.{id:N}@example.test", "Deposit Test", "x", DateTimeOffset.UtcNow, usesExternalWallet: !custodial));
        // A unique address per user, since the table keeps one account per wallet.
        db.Add(new WalletLink(Guid.NewGuid(), id, "0x" + Convert.ToHexStringLower(id.ToByteArray()) + "00000000", chainId, DateTimeOffset.UtcNow, isCustodial: custodial));
        await db.SaveChangesAsync();
        return id;
    }

    private static async Task<decimal> Balance(Guid user)
    {
        await using var db = Database();
        return await db.LedgerAccounts.Where(item => item.UserId == user).Select(item => (decimal?)item.BalanceWei).SingleOrDefaultAsync() ?? 0;
    }

    private static async Task<DepositResponse> Create(Guid user, long amount = 200_000, Guid? reference = null, TimeProvider? clock = null)
    {
        await using var db = Database();
        return await Service(db, clock).CreateAsync(user, new CreateDepositRequest { AmountVnd = amount, Reference = reference ?? Guid.NewGuid() }, default);
    }

    private static PaymentWebhookRequest Webhook(Guid id, long amount, string status = "Succeeded", string tx = "TX-1", DateTimeOffset? at = null)
    {
        var timestamp = (at ?? DateTimeOffset.UtcNow).ToUnixTimeSeconds();
        return new PaymentWebhookRequest { DepositId = id, AmountVnd = amount, Status = status, GatewayTransactionId = tx, Timestamp = timestamp, Signature = Signer.Sign(id, amount, status, tx, timestamp) };
    }

    private static async Task<PaymentWebhookResponse> Deliver(PaymentWebhookRequest webhook, TimeProvider? clock = null)
    {
        await using var db = Database();
        return await Service(db, clock).ApplyWebhookAsync(webhook, default);
    }

    private static async Task<string> Rejected(Func<Task> action) => (await Assert.ThrowsAsync<ApplicationError>(action)).Code;

    private static string UniqueTx() => "TX-" + Guid.NewGuid().ToString("N");

    [SqlFact]
    public async Task SuccessfulPaymentCreditsTheLedgerAtTheFixedRate()
    {
        var user = await NewUser();
        var deposit = await Create(user);
        Assert.Equal(DepositStatus.Pending, deposit.Status);
        Assert.Equal(0m, await Balance(user));
        var tx = UniqueTx();
        Assert.Equal(DepositStatus.Succeeded, (await Deliver(Webhook(deposit.Id, 200_000, tx: tx))).Status);
        Assert.Equal(ExchangeRate.VndToWei(200_000), await Balance(user));
        await using var db = Database();
        var entry = await db.LedgerEntries.SingleAsync(item => item.UserId == user);
        Assert.Equal(LedgerEntryType.GatewayDeposit, entry.Type);
        Assert.Equal($"deposit:{deposit.Id:N}", entry.IdempotencyKey);
        Assert.Equal($"mock:{tx}", entry.Note);
    }

    [SqlFact]
    public async Task ReplayAndConcurrentDeliveryPayOnlyOnce()
    {
        var user = await NewUser();
        var deposit = await Create(user);
        var webhook = Webhook(deposit.Id, 200_000, tx: UniqueTx());
        await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => Task.Run(() => Deliver(webhook))));
        Assert.Equal(DepositStatus.Succeeded, (await Deliver(webhook)).Status);
        Assert.Equal(ExchangeRate.VndToWei(200_000), await Balance(user));
        await using var db = Database();
        Assert.Equal(1, await db.LedgerEntries.CountAsync(item => item.UserId == user));
    }

    [SqlFact]
    public async Task ForgedTamperedOrStaleWebhooksMoveNoMoney()
    {
        var user = await NewUser();
        var deposit = await Create(user);
        var valid = Webhook(deposit.Id, 200_000, tx: UniqueTx());
        var forged = new PaymentSigner(RandomNumberGenerator.GetBytes(32));
        Assert.Equal("INVALID_PAYMENT_SIGNATURE", await Rejected(() => Deliver(new PaymentWebhookRequest
        {
            DepositId = valid.DepositId, AmountVnd = valid.AmountVnd, Status = valid.Status, GatewayTransactionId = valid.GatewayTransactionId, Timestamp = valid.Timestamp,
            Signature = forged.Sign(valid.DepositId, valid.AmountVnd, valid.Status, valid.GatewayTransactionId, valid.Timestamp)
        })));
        Assert.Equal("INVALID_PAYMENT_SIGNATURE", await Rejected(() => Deliver(new PaymentWebhookRequest
        {
            DepositId = valid.DepositId, AmountVnd = 50_000_000, Status = valid.Status, GatewayTransactionId = valid.GatewayTransactionId, Timestamp = valid.Timestamp, Signature = valid.Signature
        })));
        Assert.Equal("INVALID_PAYMENT_SIGNATURE", await Rejected(() => Deliver(Webhook(deposit.Id, 200_000, tx: UniqueTx(), at: DateTimeOffset.UtcNow.AddMinutes(-6)))));
        Assert.Equal("INVALID_PAYMENT_SIGNATURE", await Rejected(() => Deliver(Webhook(deposit.Id, 200_000, tx: UniqueTx(), at: DateTimeOffset.UtcNow.AddMinutes(6)))));
        Assert.Equal(0m, await Balance(user));
    }

    [SqlFact]
    public async Task ASignedWebhookWithTheWrongAmountIsRefusedAndLeavesTheRequestOpen()
    {
        var user = await NewUser();
        var deposit = await Create(user);
        Assert.Equal("DEPOSIT_AMOUNT_MISMATCH", await Rejected(() => Deliver(Webhook(deposit.Id, 49_000_000, tx: UniqueTx()))));
        Assert.Equal(0m, await Balance(user));
        await using var db = Database();
        Assert.Equal(DepositStatus.Pending, (await Service(db).GetAsync(user, deposit.Id, default)).Status);
    }

    [SqlFact]
    public async Task AFinishedRequestNeverChanges()
    {
        var user = await NewUser();
        var failed = await Create(user);
        var failedTx = UniqueTx();
        Assert.Equal(DepositStatus.Failed, (await Deliver(Webhook(failed.Id, 200_000, "Failed", failedTx))).Status);
        Assert.Equal("DEPOSIT_ALREADY_FINAL", await Rejected(() => Deliver(Webhook(failed.Id, 200_000, tx: UniqueTx()))));
        Assert.Equal(0m, await Balance(user));

        var paid = await Create(user);
        await Deliver(Webhook(paid.Id, 200_000, tx: UniqueTx()));
        Assert.Equal("DEPOSIT_ALREADY_FINAL", await Rejected(() => Deliver(Webhook(paid.Id, 200_000, "Failed", UniqueTx()))));
        await using (var db = Database()) Assert.Equal("DEPOSIT_ALREADY_FINAL", await Rejected(() => Service(db).CancelAsync(user, paid.Id, default)));
        Assert.Equal(ExchangeRate.VndToWei(200_000), await Balance(user));

        var cancelled = await Create(user);
        await using (var db = Database()) Assert.Equal(DepositStatus.Cancelled, (await Service(db).CancelAsync(user, cancelled.Id, default)).Status);
        await using (var db = Database()) Assert.Equal(DepositStatus.Cancelled, (await Service(db).CancelAsync(user, cancelled.Id, default)).Status);
        Assert.Equal("DEPOSIT_ALREADY_FINAL", await Rejected(() => Deliver(Webhook(cancelled.Id, 200_000, tx: UniqueTx()))));
        Assert.Equal(ExchangeRate.VndToWei(200_000), await Balance(user));
    }

    [SqlFact]
    public async Task ExpiryFollowsWhenTheGatewayPaid()
    {
        var user = await NewUser();
        var start = DateTimeOffset.UtcNow;
        var clock = new Clock(start);
        var late = await Create(user, clock: clock);
        clock.Now = start + DepositLimits.Lifetime + TimeSpan.FromSeconds(30);
        await using (var db = Database()) Assert.Equal(DepositStatus.Expired, (await Service(db, clock).GetAsync(user, late.Id, default)).Status);
        Assert.Equal("DEPOSIT_EXPIRED", await Rejected(() => Deliver(Webhook(late.Id, 200_000, tx: UniqueTx(), at: clock.Now), clock)));
        Assert.Equal(0m, await Balance(user));
        await using (var db = Database()) Assert.Equal("DEPOSIT_ALREADY_FINAL", await Rejected(() => Service(db, clock).CancelAsync(user, late.Id, default)));

        // Paid one second before the deadline, delivered after it.
        var slow = await Create(user, clock: new Clock(start));
        Assert.Equal(DepositStatus.Succeeded, (await Deliver(Webhook(slow.Id, 200_000, tx: UniqueTx(), at: start + DepositLimits.Lifetime - TimeSpan.FromSeconds(1)), clock)).Status);
        Assert.Equal(ExchangeRate.VndToWei(200_000), await Balance(user));
    }

    [SqlFact]
    public async Task CreationValidatesAmountOwnershipAndRepeats()
    {
        var user = await NewUser();
        Assert.Equal("DEPOSIT_AMOUNT_OUT_OF_RANGE", await Rejected(() => Create(user, DepositLimits.MinVnd - 1)));
        Assert.Equal("DEPOSIT_AMOUNT_OUT_OF_RANGE", await Rejected(() => Create(user, DepositLimits.MaxVnd + 1)));
        Assert.Equal(DepositLimits.MinVnd, (await Create(user, DepositLimits.MinVnd)).AmountVnd);
        Assert.Equal(DepositLimits.MaxVnd, (await Create(user, DepositLimits.MaxVnd)).AmountVnd);

        var reference = Guid.NewGuid();
        var first = await Create(user, reference: reference);
        Assert.Equal(first.Id, (await Create(user, reference: reference)).Id);
        Assert.Equal("DEPOSIT_REFERENCE_REUSED", await Rejected(() => Create(user, 300_000, reference)));

        var stranger = await NewUser();
        await using var db = Database();
        Assert.Equal("DEPOSIT_NOT_FOUND", await Rejected(() => Service(db).GetAsync(stranger, first.Id, default)));
        Assert.Equal("DEPOSIT_NOT_FOUND", await Rejected(() => Service(db).CancelAsync(stranger, first.Id, default)));
        Assert.Equal("DEPOSIT_NOT_FOUND", await Rejected(() => Service(db).PayWithMockAsync(stranger, first.Id, "Succeeded", default)));
        Assert.Empty(await Service(db).ListAsync(stranger, default));
        Assert.Equal(0m, await Balance(user));
    }

    [SqlFact]
    public async Task OpenRequestsAreCappedAndExpiredOnesDoNotCount()
    {
        var user = await NewUser();
        var start = DateTimeOffset.UtcNow;
        var clock = new Clock(start);
        for (var index = 0; index < DepositLimits.MaxOpenRequests; index++) await Create(user, clock: clock);
        Assert.Equal("TOO_MANY_OPEN_DEPOSITS", await Rejected(() => Create(user, clock: clock)));
        clock.Now = start + DepositLimits.Lifetime + TimeSpan.FromSeconds(1);
        Assert.Equal(DepositStatus.Pending, (await Create(user, clock: clock)).Status);
    }

    [SqlFact]
    public async Task MockPaymentGoesThroughTheWebhookPathAndRepeatsSafely()
    {
        var user = await NewUser();
        var deposit = await Create(user);
        await using (var db = Database()) Assert.Equal(DepositStatus.Succeeded, (await Service(db).PayWithMockAsync(user, deposit.Id, "Succeeded", default)).Status);
        await using (var db = Database()) Assert.Equal(DepositStatus.Succeeded, (await Service(db).PayWithMockAsync(user, deposit.Id, "Succeeded", default)).Status);
        Assert.Equal(ExchangeRate.VndToWei(200_000), await Balance(user));
        await using (var db = Database()) Assert.Equal("DEPOSIT_ALREADY_FINAL", await Rejected(() => Service(db).PayWithMockAsync(user, deposit.Id, "Failed", default)));
    }

    private static async Task<string> WalletOf(Guid user)
    {
        await using var db = Database();
        return await db.WalletLinks.Where(item => item.UserId == user).Select(item => item.Address).SingleAsync();
    }

    private static async Task<DepositResponse> Paid(Guid user, Guid id, IChainGateway chain)
    {
        await using var db = Database();
        return await Service(db, chain: chain).PayWithMockAsync(user, id, "Succeeded", default);
    }

    [SqlFact]
    public async Task ASelfHeldWalletReceivesEthOnChainAndNoLedgerBalance()
    {
        var user = await NewUser(custodial: false);
        var chain = new RecordingChain();
        var deposit = await Create(user);
        Assert.Equal(await WalletOf(user), deposit.PayoutAddress);
        Assert.Null(deposit.PayoutStatus);
        Assert.Empty(chain.Sent);

        var paid = await Paid(user, deposit.Id, chain);
        Assert.Equal(DepositStatus.Succeeded, paid.Status);
        Assert.Equal(DepositPayoutStatus.Sent, paid.PayoutStatus);
        Assert.Equal("0x" + new string('a', 64), paid.PayoutTransactionHash);
        var sent = Assert.Single(chain.Sent);
        Assert.Equal(HardhatKeys.Address(HardhatKeys.TreasuryIndex), sent.From);
        Assert.Equal(await WalletOf(user), sent.To);
        Assert.Equal(new BigInteger(ExchangeRate.VndToWei(200_000)), sent.Value);
        Assert.Equal(0m, await Balance(user));
        await using var db = Database();
        Assert.False(await db.LedgerEntries.AnyAsync(item => item.UserId == user));
    }

    [SqlFact]
    public async Task ACustodialDepositCreditsTheLedgerAndPutsTheEthBehindIt()
    {
        var user = await NewUser();
        var chain = new RecordingChain();
        var deposit = await Create(user);
        var paid = await Paid(user, deposit.Id, chain);
        Assert.Equal(DepositPayoutStatus.Sent, paid.PayoutStatus);
        var sent = Assert.Single(chain.Sent);
        Assert.Equal(await WalletOf(user), sent.To);
        Assert.Equal(new BigInteger(ExchangeRate.VndToWei(200_000)), sent.Value);
        Assert.Equal(ExchangeRate.VndToWei(200_000), await Balance(user));
        await using var db = Database();
        Assert.Equal(paid.PayoutTransactionHash, (await db.LedgerEntries.SingleAsync(item => item.UserId == user)).TransactionHash);
    }

    [SqlFact]
    public async Task ACustodialDepositKeepsItsLedgerCreditWhileTheChainIsDown()
    {
        var user = await NewUser();
        var chain = new RecordingChain { Failure = new ChainTransactionException("node down", notExecuted: true) };
        var deposit = await Create(user);
        Assert.Equal(DepositPayoutStatus.Queued, (await Paid(user, deposit.Id, chain)).PayoutStatus);
        Assert.Equal(ExchangeRate.VndToWei(200_000), await Balance(user));
        chain.Failure = null;
        await using (var db = Database()) Assert.Equal(DepositPayoutStatus.Sent, (await Service(db, chain: chain).RetryPayoutAsync(user, deposit.Id, default)).PayoutStatus);
        Assert.Single(chain.Sent);
        Assert.Equal(ExchangeRate.VndToWei(200_000), await Balance(user));
    }

    [SqlFact]
    public async Task RepeatedAndConcurrentWebhooksSendEthOnlyOnce()
    {
        var user = await NewUser(custodial: false);
        var chain = new RecordingChain();
        var deposit = await Create(user);
        var webhook = Webhook(deposit.Id, 200_000, tx: UniqueTx());
        await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => Task.Run(async () =>
        {
            await using var db = Database();
            await Service(db, chain: chain).ApplyWebhookAsync(webhook, default);
        })));
        Assert.Single(chain.Sent);
        await using var check = Database();
        await Service(check, chain: chain).RetryPayoutAsync(user, deposit.Id, default);
        Assert.Single(chain.Sent);
    }

    [SqlFact]
    public async Task AFailedOrCancelledPaymentSendsNothing()
    {
        var user = await NewUser(custodial: false);
        var chain = new RecordingChain();
        var failed = await Create(user);
        await using (var db = Database()) Assert.Null((await Service(db, chain: chain).PayWithMockAsync(user, failed.Id, "Failed", default)).PayoutStatus);
        var cancelled = await Create(user);
        await using (var db = Database()) await Service(db, chain: chain).CancelAsync(user, cancelled.Id, default);
        await using (var db = Database()) await Service(db, chain: chain).RetryPayoutAsync(user, failed.Id, default);
        await using (var db = Database()) await Service(db, chain: chain).RetryPayoutAsync(user, cancelled.Id, default);
        Assert.Empty(chain.Sent);
    }

    [SqlFact]
    public async Task ASendThatDidNotHappenCanBeRetried()
    {
        var user = await NewUser(custodial: false);
        var chain = new RecordingChain { Failure = new ChainTransactionException("node down", notExecuted: true) };
        var deposit = await Create(user);
        var paid = await Paid(user, deposit.Id, chain);
        Assert.Equal(DepositStatus.Succeeded, paid.Status);
        Assert.Equal(DepositPayoutStatus.Queued, paid.PayoutStatus);
        Assert.Null(paid.PayoutTransactionHash);

        chain.Failure = null;
        await using (var db = Database()) Assert.Equal(DepositPayoutStatus.Sent, (await Service(db, chain: chain).RetryPayoutAsync(user, deposit.Id, default)).PayoutStatus);
        Assert.Single(chain.Sent);
        await using (var db = Database()) await Service(db, chain: chain).RetryPayoutAsync(user, deposit.Id, default);
        Assert.Single(chain.Sent);
    }

    [SqlFact]
    public async Task ASendWithAnUnknownOutcomeIsNeverRepeated()
    {
        foreach (var failure in new Exception[] { new ChainTransactionException("no receipt", notExecuted: false), new HttpRequestException("lost connection") })
        {
            var user = await NewUser(custodial: false);
            var chain = new RecordingChain { Failure = failure };
            var deposit = await Create(user);
            Assert.Equal(DepositPayoutStatus.Sending, (await Paid(user, deposit.Id, chain)).PayoutStatus);
            chain.Failure = null;
            await using (var db = Database()) Assert.Equal(DepositPayoutStatus.Sending, (await Service(db, chain: chain).RetryPayoutAsync(user, deposit.Id, default)).PayoutStatus);
            Assert.Equal(DepositPayoutStatus.Sending, (await Paid(user, deposit.Id, chain)).PayoutStatus);
            Assert.Empty(chain.Sent);
        }
    }

    [SqlFact]
    public async Task ASelfHeldDepositNeedsALinkedLocalWalletAndItsOwner()
    {
        var unlinked = Guid.NewGuid();
        await using (var db = Database())
        {
            db.Add(new User(unlinked, $"deposit.{unlinked:N}@example.test", "Deposit Test", "x", DateTimeOffset.UtcNow, usesExternalWallet: true));
            await db.SaveChangesAsync();
        }
        Assert.Equal("WALLET_NOT_LINKED", await Rejected(() => Create(unlinked)));
        Assert.Equal("WALLET_CHAIN_UNSUPPORTED", await Rejected(async () => await Create(await NewUser(custodial: false, chainId: 11155111))));

        var user = await NewUser(custodial: false);
        var chain = new RecordingChain { Failure = new ChainTransactionException("node down", notExecuted: true) };
        var deposit = await Create(user);
        await Paid(user, deposit.Id, chain);
        chain.Failure = null;
        var stranger = await NewUser(custodial: false);
        await using (var db = Database()) Assert.Equal("DEPOSIT_NOT_FOUND", await Rejected(() => Service(db, chain: chain).RetryPayoutAsync(stranger, deposit.Id, default)));
        await using (var db = Database()) Assert.Equal("PAYMENTS_DISABLED", await Rejected(() => Service(db, enabled: false, chain: chain).RetryPayoutAsync(user, deposit.Id, default)));
        Assert.Empty(chain.Sent);
    }

    [SqlFact]
    public async Task NothingWorksWhilePaymentsAreOff()
    {
        var user = await NewUser();
        var deposit = await Create(user);
        await using var db = Database();
        var off = Service(db, enabled: false);
        Assert.Equal("PAYMENTS_DISABLED", await Rejected(() => off.CreateAsync(user, new CreateDepositRequest { AmountVnd = 200_000, Reference = Guid.NewGuid() }, default)));
        Assert.Equal("PAYMENTS_DISABLED", await Rejected(() => off.ApplyWebhookAsync(Webhook(deposit.Id, 200_000, tx: UniqueTx()), default)));
        Assert.Equal("PAYMENTS_DISABLED", await Rejected(() => off.PayWithMockAsync(user, deposit.Id, "Succeeded", default)));
        Assert.Equal(0m, await Balance(user));
    }
}
