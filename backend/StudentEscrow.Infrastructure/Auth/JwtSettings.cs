namespace StudentEscrow.Infrastructure.Auth;

public sealed class JwtSettings
{
    public string Issuer { get; set; } = "StudentEscrow.API";
    public string Audience { get; set; } = "StudentEscrow.Client";
    public string SigningKey { get; set; } = string.Empty;
    public int ExpirationMinutes { get; set; } = 60;
}
