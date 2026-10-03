using System.IdentityModel.Tokens.Jwt;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StudentEscrow.Application.Common;

namespace StudentEscrow.API.Common;

[ApiController]
[Authorize]
public abstract class AuthenticatedController : ControllerBase
{
    protected Guid CurrentUserId => Guid.TryParse(User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value, out var userId)
        ? userId : throw new ApplicationError("UNAUTHORIZED", "Invalid account identifier.", 401);
}
