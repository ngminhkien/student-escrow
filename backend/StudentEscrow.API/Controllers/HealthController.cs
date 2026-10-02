using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StudentEscrow.Infrastructure.Persistence;

namespace StudentEscrow.API.Controllers;

public sealed record HealthResponse(string Status, string Component, string Stage);

[ApiController]
[Route("api/health")]
public sealed class HealthController(StudentEscrowDbContext database) : ControllerBase
{
    [HttpGet("live")]
    [ProducesResponseType<HealthResponse>(StatusCodes.Status200OK)]
    public ActionResult<HealthResponse> Live() => Ok(new HealthResponse("healthy", "api", "01-backend-foundation"));

    [HttpGet("ready")]
    [ProducesResponseType<HealthResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<HealthResponse>(StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult<HealthResponse>> Ready(CancellationToken cancellationToken)
    {
        try
        {
            var pending = await database.Database.GetPendingMigrationsAsync(cancellationToken);
            if (pending.Any() || !await database.Database.CanConnectAsync(cancellationToken))
            {
                return StatusCode(503, new HealthResponse("unhealthy", "database", "01-backend-foundation"));
            }

            await database.Users.AsNoTracking().Select(user => user.Id).Take(1).ToListAsync(cancellationToken);
            return Ok(new HealthResponse("healthy", "database", "01-backend-foundation"));
        }
        catch (Exception) when (!cancellationToken.IsCancellationRequested)
        {
            return StatusCode(503, new HealthResponse("unhealthy", "database", "01-backend-foundation"));
        }
    }
}
