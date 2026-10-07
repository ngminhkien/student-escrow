using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StudentEscrow.Domain.Orders;
using StudentEscrow.Infrastructure.Orders;
using StudentEscrow.Infrastructure.Persistence;

namespace StudentEscrow.API.Controllers;

[ApiController]
[Route("api/health/blockchain")]
public sealed class BlockchainHealthController(BlockchainSettings settings, ManifestProvider manifests,
    StudentEscrowDbContext db, TimeProvider clock) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        if (!settings.Enabled) return StatusCode(503, new { status = "Disabled" });
        try
        {
            var manifest = await manifests.ReadAsync(ct);
            var deployment = await db.Set<ChainDeployment>().AsNoTracking().SingleOrDefaultAsync(d => d.Id == manifest.DeploymentId, ct);
            var status = deployment is null ? "Syncing" : deployment.CheckedAt is null
                || clock.GetUtcNow() - deployment.CheckedAt > TimeSpan.FromSeconds(30) ? "Stale" : deployment.Status;
            return StatusCode(status == "Ready" ? 200 : 503, new { status, manifest.DeploymentId, manifest.ChainId,
                manifest.ContractAddress, manifest.DeploymentBlock, manifest.DeploymentBlockHash,
                lastIndexedBlock = deployment?.LastBlock, deployment?.CheckedAt, settings.Confirmations });
        }
        catch (Exception) when (!ct.IsCancellationRequested) { return StatusCode(503, new { status = "Unavailable" }); }
    }
}
