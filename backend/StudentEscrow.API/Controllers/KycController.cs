using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using StudentEscrow.API.Common;
using StudentEscrow.Application.Kyc;

namespace StudentEscrow.API.Controllers;

[Route("api/kyc")]
[EnableRateLimiting("wallet-kyc")]
public sealed class KycController(IKycService kyc) : AuthenticatedController
{
    [HttpGet("me")]
    public async Task<ActionResult<KycResponse>> Me(CancellationToken cancellationToken) =>
        Ok(await kyc.GetAsync(CurrentUserId, cancellationToken));

    [HttpPost("submissions")]
    public async Task<ActionResult<KycResponse>> Submit(KycRequest request, CancellationToken cancellationToken) =>
        Ok(await kyc.SubmitAsync(CurrentUserId, request, cancellationToken));
}
