using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using StudentEscrow.Application.Common;
using StudentEscrow.Application.Wallets;
using StudentEscrow.Domain.Ledger;
using StudentEscrow.Infrastructure.Ledger;
using StudentEscrow.Infrastructure.Orders;
using StudentEscrow.Infrastructure.Persistence;
using StudentEscrow.Infrastructure.Wallets;

namespace StudentEscrow.Infrastructure.Payments;

public sealed class DepositService(StudentEscrowDbContext db, LedgerService ledger, IChainGateway chain, PaymentSettings settings, PaymentSigner signer,
    TimeProvider clock, ILogger<DepositService> logger)
{
    public const string MockGateway = "mock";
    public static readonly TimeSpan WebhookTolerance = TimeSpan.FromMinutes(5);
    private const int HistorySize = 10;

    public async Task<DepositResponse> CreateAsync(Guid userId, CreateDepositRequest request, CancellationToken ct)
    {
        RequireEnabled();
        if (request.Reference == Guid.Empty) throw new ApplicationError("VALIDATION_ERROR", "Thiếu mã tham chiếu của yêu cầu nạp.", 400);
        if (request.AmountVnd is < DepositLimits.MinVnd or > DepositLimits.MaxVnd)
            throw new ApplicationError("DEPOSIT_AMOUNT_OUT_OF_RANGE",
                $"Số tiền nạp phải từ {ExchangeRate.DisplayVnd(ExchangeRate.VndToWei(DepositLimits.MinVnd))} đến {ExchangeRate.DisplayVnd(ExchangeRate.VndToWei(DepositLimits.MaxVnd))}.", 400);
        var wallet = await db.WalletLinks.AsNoTracking().SingleOrDefaultAsync(link => link.UserId == userId, ct)
            ?? throw new ApplicationError("WALLET_NOT_LINKED", "Hãy liên kết ví trước khi nạp tiền.", 409);
        // The treasury only holds ETH on the local chain.
        if (!wallet.IsCustodial && wallet.ChainId != CustodialWalletProvisioner.LocalChainId)
            throw new ApplicationError("WALLET_CHAIN_UNSUPPORTED", "Chỉ nạp được vào ví liên kết trên mạng local.", 409);

        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await SqlLocks.AcquireAsync(db, "deposit-user:" + userId, ct);
        var now = clock.GetUtcNow();
        var existing = await db.DepositRequests.AsNoTracking().SingleOrDefaultAsync(item => item.UserId == userId && item.Reference == request.Reference, ct);
        if (existing is not null)
        {
            if (existing.AmountVnd != request.AmountVnd)
                throw new ApplicationError("DEPOSIT_REFERENCE_REUSED", "Mã tham chiếu này đã dùng cho một số tiền khác.", 409);
            return ToResponse(existing, now);
        }
        var open = await db.DepositRequests.CountAsync(item => item.UserId == userId && item.Status == DepositStatus.Pending && item.ExpiresAt >= now, ct);
        if (open >= DepositLimits.MaxOpenRequests)
            throw new ApplicationError("TOO_MANY_OPEN_DEPOSITS", "Bạn có quá nhiều yêu cầu nạp đang chờ. Hãy hoàn tất hoặc hủy bớt.", 409);
        var deposit = new DepositRequest(Guid.NewGuid(), userId, request.AmountVnd, request.Reference, MockGateway, now, now + DepositLimits.Lifetime, wallet.Address, wallet.IsCustodial);
        db.Add(deposit);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return ToResponse(deposit, now);
    }

    public async Task<IReadOnlyList<DepositResponse>> ListAsync(Guid userId, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var items = await db.DepositRequests.AsNoTracking().Where(item => item.UserId == userId)
            .OrderByDescending(item => item.CreatedAt).Take(HistorySize).ToListAsync(ct);
        return items.ConvertAll(item => ToResponse(item, now));
    }

    public async Task<DepositResponse> GetAsync(Guid userId, Guid id, CancellationToken ct)
    {
        var deposit = await db.DepositRequests.AsNoTracking().SingleOrDefaultAsync(item => item.Id == id && item.UserId == userId, ct)
            ?? throw NotFound();
        return ToResponse(deposit, clock.GetUtcNow());
    }

    public async Task<DepositResponse> CancelAsync(Guid userId, Guid id, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await SqlLocks.AcquireAsync(db, "deposit:" + id, ct);
        var deposit = await db.DepositRequests.SingleOrDefaultAsync(item => item.Id == id && item.UserId == userId, ct) ?? throw NotFound();
        var now = clock.GetUtcNow();
        if (deposit.Status == DepositStatus.Cancelled) return ToResponse(deposit, now);
        if (deposit.StatusAt(now) != DepositStatus.Pending)
            throw new ApplicationError("DEPOSIT_ALREADY_FINAL", "Yêu cầu nạp này đã kết thúc nên không hủy được.", 409);
        deposit.Complete(DepositStatus.Cancelled, null, now);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return ToResponse(deposit, now);
    }

    // Stands in for the gateway's own page: the outcome is chosen by a person, then reported through the real webhook path.
    public async Task<DepositResponse> PayWithMockAsync(Guid userId, Guid id, string outcome, CancellationToken ct)
    {
        RequireEnabled();
        var deposit = await db.DepositRequests.AsNoTracking().SingleOrDefaultAsync(item => item.Id == id && item.UserId == userId, ct) ?? throw NotFound();
        var transactionId = "MOCK-" + deposit.Id.ToString("N");
        var timestamp = clock.GetUtcNow().ToUnixTimeSeconds();
        await ApplyWebhookAsync(new PaymentWebhookRequest
        {
            DepositId = deposit.Id, AmountVnd = deposit.AmountVnd, Status = outcome, GatewayTransactionId = transactionId, Timestamp = timestamp,
            Signature = signer.Sign(deposit.Id, deposit.AmountVnd, outcome, transactionId, timestamp)
        }, ct);
        return await GetAsync(userId, id, ct);
    }

    public async Task<DepositResponse> RetryPayoutAsync(Guid userId, Guid id, CancellationToken ct)
    {
        RequireEnabled();
        await GetAsync(userId, id, ct);
        await SendPayoutAsync(id);
        return await GetAsync(userId, id, ct);
    }

    // The single path that can turn a deposit into money. Gateways retry, so a repeat of the same result succeeds without paying again.
    public async Task<PaymentWebhookResponse> ApplyWebhookAsync(PaymentWebhookRequest webhook, CancellationToken ct)
    {
        var result = await SettleAsync(webhook, ct);
        // After the commit: a chain transaction cannot join the SQL one, and the gateway's payment stands either way.
        if (result.Status == DepositStatus.Succeeded) await SendPayoutAsync(webhook.DepositId);
        return result;
    }

    private async Task<PaymentWebhookResponse> SettleAsync(PaymentWebhookRequest webhook, CancellationToken ct)
    {
        RequireEnabled();
        if (!signer.Verify(webhook.DepositId, webhook.AmountVnd, webhook.Status, webhook.GatewayTransactionId, webhook.Timestamp, webhook.Signature))
            throw new ApplicationError("INVALID_PAYMENT_SIGNATURE", "Chữ ký webhook không hợp lệ.", 401);
        var now = clock.GetUtcNow();
        if (!FreshTimestamp(webhook.Timestamp, now, out var paidAt))
            throw new ApplicationError("INVALID_PAYMENT_SIGNATURE", "Webhook đã quá hạn.", 401);

        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await SqlLocks.AcquireAsync(db, "deposit:" + webhook.DepositId, ct);
        var deposit = await db.DepositRequests.SingleOrDefaultAsync(item => item.Id == webhook.DepositId, ct) ?? throw NotFound();
        if (deposit.AmountVnd != webhook.AmountVnd)
        {
            logger.LogWarning("Webhook for deposit {DepositId} reported {Reported} VND, expected {Expected} VND.", deposit.Id, webhook.AmountVnd, deposit.AmountVnd);
            throw new ApplicationError("DEPOSIT_AMOUNT_MISMATCH", "Số tiền trong webhook không khớp với yêu cầu nạp.", 409);
        }
        if (deposit.Status != DepositStatus.Pending)
        {
            if (deposit.Status == webhook.Status && deposit.GatewayTransactionId == webhook.GatewayTransactionId)
                return new PaymentWebhookResponse(deposit.Status);
            logger.LogWarning("Webhook {Status} ignored for deposit {DepositId}, already {Current}.", webhook.Status, deposit.Id, deposit.Status);
            throw new ApplicationError("DEPOSIT_ALREADY_FINAL", "Yêu cầu nạp này đã kết thúc.", 409);
        }
        // Judged by when the gateway says it paid, so a payment made just in time survives a slow webhook.
        if (paidAt > deposit.ExpiresAt)
        {
            deposit.Complete(DepositStatus.Expired, null, now);
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            throw new ApplicationError("DEPOSIT_EXPIRED", "Yêu cầu nạp đã hết hạn. Hãy tạo yêu cầu mới.", 409);
        }
        deposit.Complete(webhook.Status, webhook.GatewayTransactionId, now);
        if (webhook.Status == DepositStatus.Succeeded && deposit.CreditsLedger)
            await ledger.PostAsync(new LedgerPosting(deposit.UserId, LedgerEntryType.GatewayDeposit, ExchangeRate.VndToWei(deposit.AmountVnd),
                $"deposit:{deposit.Id:N}", Note: $"{deposit.Gateway}:{webhook.GatewayTransactionId}"), ct);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return new PaymentWebhookResponse(deposit.Status);
    }

    // Claiming is one conditional UPDATE, committed before the broadcast: only one caller can win it, and a retry,
    // a repeated webhook or a crash can never pay twice. It also ignores any stale copy this DbContext is tracking.
    private async Task SendPayoutAsync(Guid id)
    {
        var claimed = await db.DepositRequests.Where(item => item.Id == id && item.PayoutStatus == DepositPayoutStatus.Queued)
            .ExecuteUpdateAsync(set => set.SetProperty(item => item.PayoutStatus, DepositPayoutStatus.Sending), CancellationToken.None);
        if (claimed == 0) return;
        var payout = await db.DepositRequests.AsNoTracking().Where(item => item.Id == id)
            .Select(item => new { item.PayoutAddress, item.AmountVnd }).SingleAsync(CancellationToken.None);
        var sending = db.DepositRequests.Where(item => item.Id == id && item.PayoutStatus == DepositPayoutStatus.Sending);
        string hash;
        try
        {
            hash = await chain.SendFromTreasuryAsync(payout.PayoutAddress!, new System.Numerics.BigInteger(ExchangeRate.VndToWei(payout.AmountVnd)), CancellationToken.None);
        }
        catch (ChainTransactionException exception) when (exception.NotExecuted)
        {
            logger.LogWarning("Payout for deposit {DepositId} was not sent: {Reason}", id, exception.Message);
            await sending.ExecuteUpdateAsync(set => set.SetProperty(item => item.PayoutStatus, DepositPayoutStatus.Queued), CancellationToken.None);
            return;
        }
        catch (Exception exception)
        {
            // Stays Sending: resending could pay twice, so a person has to compare it with the chain.
            logger.LogError(exception, "Payout for deposit {DepositId} has an unknown outcome and needs checking on chain.", id);
            return;
        }
        await sending.ExecuteUpdateAsync(set => set.SetProperty(item => item.PayoutStatus, DepositPayoutStatus.Sent)
            .SetProperty(item => item.PayoutTransactionHash, hash), CancellationToken.None);
        var key = $"deposit:{id:N}";
        await db.LedgerEntries.Where(item => item.IdempotencyKey == key)
            .ExecuteUpdateAsync(set => set.SetProperty(item => item.TransactionHash, hash), CancellationToken.None);
    }

    private static bool FreshTimestamp(long timestamp, DateTimeOffset now, out DateTimeOffset paidAt)
    {
        paidAt = default;
        // Out-of-range values would throw from FromUnixTimeSeconds.
        if (timestamp < 0 || timestamp > DateTimeOffset.MaxValue.ToUnixTimeSeconds()) return false;
        paidAt = DateTimeOffset.FromUnixTimeSeconds(timestamp);
        return (now - paidAt).Duration() <= WebhookTolerance;
    }

    private void RequireEnabled()
    {
        if (!settings.MockEnabled) throw new ApplicationError("PAYMENTS_DISABLED", "Chức năng nạp tiền chưa được bật.", 503);
    }

    private static ApplicationError NotFound() => new("DEPOSIT_NOT_FOUND", "Không tìm thấy yêu cầu nạp.", 404);

    private static DepositResponse ToResponse(DepositRequest item, DateTimeOffset now) => new(item.Id, item.AmountVnd,
        ExchangeRate.Format(ExchangeRate.VndToWei(item.AmountVnd)), item.StatusAt(now), item.Gateway,
        item.GatewayTransactionId, item.CreatedAt, item.ExpiresAt, item.CompletedAt, item.PayoutAddress, item.PayoutStatus, item.PayoutTransactionHash);
}
