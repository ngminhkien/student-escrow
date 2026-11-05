using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using StudentEscrow.API.Common;
using StudentEscrow.Application.Analytics;
using StudentEscrow.Infrastructure.Orders;
using StudentEscrow.Infrastructure.Risk;

namespace StudentEscrow.API.Controllers;

[Route("api/analytics")]
[EnableRateLimiting("orders")]
public sealed class AnalyticsController(AnalyticsService analytics, CustodialChainService custody) : AuthenticatedController
{
    // Platform-wide figures, so the same contract role as the rest of the Admin workspace.
    [HttpGet("summary")]
    public async Task<ActionResult<AnalyticsSummary>> Summary([FromQuery] string source = AnalyticsSources.Chain, [FromQuery] Guid? deploymentId = null, CancellationToken ct = default)
    {
        await custody.RequireAdminAsync(CurrentUserId, ct);
        return Ok(await analytics.SummaryAsync(source, deploymentId, ct));
    }
}
