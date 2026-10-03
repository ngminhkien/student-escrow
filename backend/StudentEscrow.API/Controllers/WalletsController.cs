using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using StudentEscrow.API.Common;
using StudentEscrow.Application.Wallets;

namespace StudentEscrow.API.Controllers;

[Route("api/wallets")]
[EnableRateLimiting("wallet-kyc")]
public sealed class WalletsController(IWalletService wallets) : AuthenticatedController
{
    [HttpGet("me")]
    public async Task<ActionResult<WalletResponse>> Me(CancellationToken cancellationToken) =>
        Ok(await wallets.GetAsync(CurrentUserId, cancellationToken));

    [HttpPost("challenges")]
    public async Task<ActionResult<WalletChallengeResponse>> Challenge(WalletChallengeRequest request, CancellationToken cancellationToken) =>
        Ok(await wallets.ChallengeAsync(CurrentUserId, request, cancellationToken));

    [HttpPost("link")]
    public async Task<ActionResult<WalletResponse>> Link(WalletLinkRequest request, CancellationToken cancellationToken) =>
        Ok(await wallets.LinkAsync(CurrentUserId, request, cancellationToken));
}
