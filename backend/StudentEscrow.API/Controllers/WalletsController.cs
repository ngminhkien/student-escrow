using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using StudentEscrow.API.Common;
using StudentEscrow.Application.Wallets;
using StudentEscrow.Infrastructure.Ledger;

namespace StudentEscrow.API.Controllers;

[Route("api/wallets")]
[EnableRateLimiting("wallet-kyc")]
public sealed class WalletsController(IWalletService wallets, LedgerService ledger) : AuthenticatedController
{
    // Reads run after every action and on a timer, so they cannot share the strict limit meant for writes.
    [EnableRateLimiting("orders")]
    [HttpGet("me")]
    public async Task<ActionResult<WalletResponse>> Me(CancellationToken cancellationToken) =>
        Ok(await wallets.GetAsync(CurrentUserId, cancellationToken));

    [EnableRateLimiting("orders")]
    [HttpGet("account")]
    public async Task<ActionResult<WalletAccountResponse>> Account(CancellationToken cancellationToken) =>
        Ok(await ledger.AccountAsync(CurrentUserId, cancellationToken));

    [AllowAnonymous]
    [DisableRateLimiting]
    [HttpGet("exchange-rate")]
    public ActionResult<ExchangeRateResponse> Rate() => Ok(new ExchangeRateResponse(ExchangeRate.VndPerEth, ExchangeRate.WeiPerVnd, true));

    [HttpPost("challenges")]
    public async Task<ActionResult<WalletChallengeResponse>> Challenge(WalletChallengeRequest request, CancellationToken cancellationToken) =>
        Ok(await wallets.ChallengeAsync(CurrentUserId, request, cancellationToken));

    [HttpPost("link")]
    public async Task<ActionResult<WalletResponse>> Link(WalletLinkRequest request, CancellationToken cancellationToken) =>
        Ok(await wallets.LinkAsync(CurrentUserId, request, cancellationToken));
}
