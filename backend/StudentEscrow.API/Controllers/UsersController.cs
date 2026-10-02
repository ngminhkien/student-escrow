using System.IdentityModel.Tokens.Jwt;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StudentEscrow.API.Common;
using StudentEscrow.Application.Auth;

namespace StudentEscrow.API.Controllers;

[ApiController]
[Authorize]
[Route("api/users")]
public sealed class UsersController(IAuthService auth) : ControllerBase
{
    [HttpGet("me")]
    [ProducesResponseType<UserResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ApiError>(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType<ApiError>(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<UserResponse>> Me(CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value, out var userId))
        {
            return Unauthorized(new ApiError("UNAUTHORIZED", "Token không có định danh hợp lệ.", HttpContext.TraceIdentifier));
        }

        return Ok(await auth.GetProfileAsync(userId, cancellationToken));
    }
}
