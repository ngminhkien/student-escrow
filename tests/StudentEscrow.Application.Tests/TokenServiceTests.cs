using System.IdentityModel.Tokens.Jwt;
using System.Text;
using Microsoft.IdentityModel.Tokens;
using StudentEscrow.Domain.Users;
using StudentEscrow.Infrastructure.Auth;
using Xunit;

namespace StudentEscrow.Application.Tests;

public sealed class TokenServiceTests
{
    [Fact]
    public void IssuedTokenValidatesAndDoesNotContainPasswordOrEmail()
    {
        var settings = new JwtSettings { SigningKey = "test-only-key-which-is-long-enough-for-hmac-sha256" };
        var user = new User(Guid.NewGuid(), "buyer@example.com", "Buyer", "private-password-hash", DateTimeOffset.UtcNow);
        var result = new TokenService(settings, TimeProvider.System).Issue(user);
        var parameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = settings.Issuer,
            ValidAudience = settings.Audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(settings.SigningKey)),
            ValidAlgorithms = [SecurityAlgorithms.HmacSha256]
        };
        var handler = new JwtSecurityTokenHandler { MapInboundClaims = false };
        var principal = handler.ValidateToken(result.AccessToken, parameters, out _);
        Assert.Equal(user.Id.ToString(), principal.FindFirst("sub")?.Value);
        Assert.DoesNotContain(user.Email, handler.ReadJwtToken(result.AccessToken).Payload.SerializeToJson());
        Assert.DoesNotContain(user.PasswordHash, handler.ReadJwtToken(result.AccessToken).Payload.SerializeToJson());
        parameters.IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes("different-test-only-key-long-enough-for-hmac-sha256"));
        Assert.ThrowsAny<SecurityTokenException>(() => handler.ValidateToken(result.AccessToken, parameters, out _));
    }

    [Fact]
    public void PasswordHashesUseDifferentSalts()
    {
        var passwords = new PasswordService();
        var first = passwords.Hash("DemoPassword123!");
        var second = passwords.Hash("DemoPassword123!");
        Assert.NotEqual(first, second);
        Assert.True(passwords.Verify(first, "DemoPassword123!"));
        Assert.False(passwords.Verify(first, "WrongPassword!"));
    }
}
