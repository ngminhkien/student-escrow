using System.ComponentModel.DataAnnotations;
using StudentEscrow.Domain.Users;

namespace StudentEscrow.Application.Auth;

public sealed class RegisterRequest
{
    public RegisterRequest() { }

    public RegisterRequest(string email, string fullName, string password)
    {
        Email = email;
        FullName = fullName;
        Password = password;
    }

    [Required, EmailAddress, StringLength(254)]
    public string Email { get; init; } = string.Empty;

    [Required, StringLength(100, MinimumLength = 2)]
    public string FullName { get; init; } = string.Empty;

    [Required, StringLength(128, MinimumLength = 10)]
    public string Password { get; init; } = string.Empty;
}

public sealed class LoginRequest
{
    public LoginRequest() { }

    public LoginRequest(string email, string password)
    {
        Email = email;
        Password = password;
    }

    [Required, EmailAddress, StringLength(254)]
    public string Email { get; init; } = string.Empty;

    [Required, StringLength(128)]
    public string Password { get; init; } = string.Empty;
}

public sealed record UserResponse(Guid Id, string Email, string FullName, DateTimeOffset CreatedAt)
{
    public static UserResponse FromUser(User user) => new(user.Id, user.Email, user.FullName, user.CreatedAt);
}

public sealed record AuthResponse(string AccessToken, string TokenType, DateTimeOffset ExpiresAt, UserResponse User);

public interface IUserRepository
{
    Task<User?> FindByEmailAsync(string normalizedEmail, CancellationToken cancellationToken);
    Task<User?> FindByIdAsync(Guid id, CancellationToken cancellationToken);
    Task AddAsync(User user, CancellationToken cancellationToken);
}

public interface IPasswordService
{
    string DummyHash { get; }
    string Hash(string password);
    bool Verify(string passwordHash, string password);
}

public interface ITokenService
{
    AuthResponse Issue(User user);
}

public interface IAuthService
{
    Task<AuthResponse> RegisterAsync(RegisterRequest request, CancellationToken cancellationToken);
    Task<AuthResponse> LoginAsync(LoginRequest request, CancellationToken cancellationToken);
    Task<UserResponse> GetProfileAsync(Guid userId, CancellationToken cancellationToken);
}
