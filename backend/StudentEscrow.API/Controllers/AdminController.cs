using System.Numerics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using StudentEscrow.API.Common;
using StudentEscrow.Application.Common;
using StudentEscrow.Application.Orders;
using StudentEscrow.Application.Wallets;
using StudentEscrow.Domain.Ledger;
using StudentEscrow.Domain.Orders;
using StudentEscrow.Infrastructure.Ledger;
using StudentEscrow.Infrastructure.Orders;
using StudentEscrow.Infrastructure.Persistence;
using StudentEscrow.Infrastructure.Wallets;

namespace StudentEscrow.API.Controllers;

[Route("api/admin")]
[EnableRateLimiting("orders")]
public sealed class AdminController(CustodialChainService custody, LedgerService ledger, StudentEscrowDbContext db,
    IChainGateway chain, ManifestProvider manifests, IWalletSignatureVerifier addresses) : AuthenticatedController
{
    [HttpGet("accounts")]
    public async Task<ActionResult<AdminAccountsResponse>> Accounts(CancellationToken ct)
    {
        await custody.RequireAdminAsync(CurrentUserId, ct);
        var manifest = await manifests.ReadAsync(ct);
        var rows = await (from user in db.Users.AsNoTracking()
                          join link in db.WalletLinks.AsNoTracking() on user.Id equals link.UserId
                          join account in db.LedgerAccounts.AsNoTracking() on user.Id equals account.UserId into accounts
                          from account in accounts.DefaultIfEmpty()
                          join kyc in db.KycSubmissions.AsNoTracking() on link.Id equals kyc.WalletLinkId into submissions
                          from kyc in submissions.DefaultIfEmpty()
                          orderby user.CreatedAt
                          select new { user.Id, user.Email, user.FullName, link.Address, link.IsCustodial,
                              Balance = account == null ? 0m : account.BalanceWei, Kyc = kyc == null ? "NOT_SUBMITTED" : kyc.Status })
            .Take(200).ToListAsync(ct);
        var result = new List<AdminAccountResponse>();
        foreach (var row in rows)
        {
            result.Add(new(row.Id, row.Email, row.FullName, addresses.ChecksumAddress(row.Address), row.IsCustodial,
                ExchangeRate.Format(row.Balance), ExchangeRate.WeiToVnd(row.Balance), (await chain.BalanceAsync(row.Address, ct)).ToString(),
                row.Kyc, await custody.IsVerifiedAsync(manifest.ContractAddress, row.Address, ct),
                await custody.IsArbiterAsync(manifest.ContractAddress, row.Address, ct)));
        }
        var total = await db.LedgerAccounts.AsNoTracking().SumAsync(account => account.BalanceWei, ct);
        var treasury = await chain.BalanceAsync(HardhatKeys.Address(HardhatKeys.TreasuryIndex), ct);
        return Ok(new AdminAccountsResponse(result, ExchangeRate.Format(total), ExchangeRate.WeiToVnd(total), treasury.ToString(),
            (await chain.BalanceAsync(manifest.ContractAddress, ct)).ToString()));
    }

    [HttpPost("wallets/verification")]
    public async Task<ActionResult<ChainActionResponse>> Verification(AdminVerificationRequest request, CancellationToken ct) =>
        Ok(await custody.SetVerifiedAsync(CurrentUserId, addresses.NormalizeAddress(request.Address), request.Verified, ct));

    [HttpPost("wallets/kyc-admin")]
    public async Task<ActionResult<ChainActionResponse>> KycAdmin(AdminRoleRequest request, CancellationToken ct) =>
        Ok(await custody.SetKycAdminAsync(CurrentUserId, addresses.NormalizeAddress(request.Address), request.Grant, ct));

    // What SQL believes about orders on the current contract, for the browser to compare with the node itself.
    [HttpGet("chain-orders")]
    public async Task<ActionResult<IReadOnlyList<AdminChainOrderResponse>>> ChainOrders(CancellationToken ct)
    {
        await custody.RequireAdminAsync(CurrentUserId, ct);
        var manifest = await manifests.ReadAsync(ct);
        return Ok(await db.Set<ChainOrder>().AsNoTracking().Where(order => order.DeploymentId == manifest.DeploymentId)
            .OrderBy(order => order.OrderId.Length).ThenBy(order => order.OrderId).Take(500)
            .Select(order => new AdminChainOrderResponse(order.OrderId, order.State, order.AmountWei)).ToListAsync(ct));
    }

    // Only accounts qualify: Buyers and Sellers must be able to see who would rule on their order.
    [HttpPost("arbiters")]
    public async Task<ActionResult<ChainActionResponse>> Arbiter(AdminArbiterRequest request, CancellationToken ct)
    {
        var address = addresses.NormalizeAddress(request.Address);
        if (!await db.WalletLinks.AsNoTracking().AnyAsync(link => link.Address == address, ct))
            throw new ApplicationError("ACCOUNT_NOT_FOUND", "Không tìm thấy tài khoản của ví này.", 404);
        return Ok(await custody.SetArbiterAsync(CurrentUserId, address, request.Approved, ct));
    }

    // Manual adjustment by staff. Self-service deposits go through DepositService.
    [HttpPost("wallets/credits")]
    public async Task<ActionResult<WalletAccountResponse>> Credit(AdminCreditRequest request, CancellationToken ct)
    {
        var admin = await custody.RequireAdminAsync(CurrentUserId, ct);
        var address = addresses.NormalizeAddress(request.Address);
        var target = await db.WalletLinks.AsNoTracking().SingleOrDefaultAsync(link => link.Address == address, ct)
            ?? throw new ApplicationError("ACCOUNT_NOT_FOUND", "Không tìm thấy tài khoản của ví này.", 404);
        if (!target.IsCustodial)
            throw new ApplicationError("CUSTODIAL_WALLET_REQUIRED", "Tài khoản dùng ví MetaMask không có số dư trong sổ cái.", 409);
        var amountWei = ExchangeRate.VndToWei(request.AmountVnd);
        var entry = await ledger.PostAsync(new LedgerPosting(target.UserId, LedgerEntryType.AdminCredit, amountWei,
            $"admin-credit:{request.Reference:N}", ActorUserId: admin.UserId, Note: request.Note?.Trim()), ct);
        if (entry is not null) await custody.BackLedgerCreditAsync(entry.Id, address, amountWei);
        return Ok(await ledger.AccountAsync(target.UserId, ct));
    }
}
