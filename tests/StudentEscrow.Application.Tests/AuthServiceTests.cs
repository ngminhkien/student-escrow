using StudentEscrow.Application.Auth;
using StudentEscrow.Application.Common;
using StudentEscrow.Domain.Users;
using StudentEscrow.Infrastructure.Auth;
using Xunit;

namespace StudentEscrow.Application.Tests;

public sealed class AuthServiceTests
{
    private readonly MemoryUserRepository users = new();
    private readonly PasswordService passwords = new();
    private readonly JwtSettings settings = new()
    {
        SigningKey = "test-only-key-which-is-long-enough-for-hmac-sha256"
    };

    private AuthService CreateService() => new(users, passwords, new TokenService(settings, TimeProvider.System), TimeProvider.System);

    [Fact]
    public async Task RegistrationHashesPasswordAndNormalizesEmail()
    {
        var result = await CreateService().RegisterAsync(new RegisterRequest("Buyer@example.com", "  Demo Buyer  ", "DemoPassword123!"), default);
        var stored = Assert.Single(users.Items);
        Assert.Equal("BUYER@EXAMPLE.COM", stored.NormalizedEmail);
        Assert.Equal("Demo Buyer", stored.FullName);
        Assert.NotEqual("DemoPassword123!", stored.PasswordHash);
        Assert.True(passwords.Verify(stored.PasswordHash, "DemoPassword123!"));
        Assert.Equal(stored.Id, result.User.Id);
        Assert.Equal("Bearer", result.TokenType);
    }

    [Fact]
    public async Task DuplicateEmailIsRejectedRegardlessOfCase()
    {
        var service = CreateService();
        await service.RegisterAsync(new RegisterRequest("buyer@example.com", "Buyer", "DemoPassword123!"), default);
        var error = await Assert.ThrowsAsync<ApplicationError>(() => service.RegisterAsync(
            new RegisterRequest("BUYER@example.com", "Other", "DemoPassword123!"), default));
        Assert.Equal(409, error.StatusCode);
        Assert.Equal("EMAIL_ALREADY_EXISTS", error.Code);
        Assert.Single(users.Items);
    }

    [Theory]
    [InlineData("buyer@example.com", "WrongPassword!")]
    [InlineData("unknown@example.com", "DemoPassword123!")]
    public async Task UnknownEmailAndWrongPasswordReturnSameError(string email, string password)
    {
        var service = CreateService();
        await service.RegisterAsync(new RegisterRequest("buyer@example.com", "Buyer", "DemoPassword123!"), default);
        var error = await Assert.ThrowsAsync<ApplicationError>(() => service.LoginAsync(new LoginRequest(email, password), default));
        Assert.Equal(401, error.StatusCode);
        Assert.Equal("INVALID_CREDENTIALS", error.Code);
        Assert.Equal("Email hoặc mật khẩu không đúng.", error.Message);
    }

    [Theory]
    [InlineData("not-an-email", "Buyer", "DemoPassword123!")]
    [InlineData("buyer@example.com", "Buyer", "short")]
    [InlineData("buyer@example.com", "  ", "DemoPassword123!")]
    public async Task InvalidRegistrationDoesNotPersistUser(string email, string fullName, string password)
    {
        var error = await Assert.ThrowsAsync<ApplicationError>(() => CreateService().RegisterAsync(
            new RegisterRequest(email, fullName, password), default));
        Assert.Equal(400, error.StatusCode);
        Assert.Empty(users.Items);
    }

    [Fact]
    public async Task LoginAndProfileReturnPersistedIdentity()
    {
        var service = CreateService();
        var registered = await service.RegisterAsync(new RegisterRequest("buyer@example.com", "Buyer", "DemoPassword123!"), default);
        var login = await service.LoginAsync(new LoginRequest("BUYER@example.com", "DemoPassword123!"), default);
        var profile = await service.GetProfileAsync(registered.User.Id, default);
        Assert.Equal(registered.User.Id, login.User.Id);
        Assert.Equal(registered.User, profile);
        Assert.NotEqual(registered.AccessToken, login.AccessToken);
    }

    [Fact]
    public async Task MissingProfileIsNotFound()
    {
        var error = await Assert.ThrowsAsync<ApplicationError>(() => CreateService().GetProfileAsync(Guid.NewGuid(), default));
        Assert.Equal(404, error.StatusCode);
    }

    private sealed class MemoryUserRepository : IUserRepository
    {
        public List<User> Items { get; } = [];
        public Task<User?> FindByEmailAsync(string normalizedEmail, CancellationToken cancellationToken) =>
            Task.FromResult(Items.SingleOrDefault(user => user.NormalizedEmail == normalizedEmail));
        public Task<User?> FindByIdAsync(Guid id, CancellationToken cancellationToken) =>
            Task.FromResult(Items.SingleOrDefault(user => user.Id == id));
        public Task AddAsync(User user, CancellationToken cancellationToken)
        {
            Items.Add(user);
            return Task.CompletedTask;
        }
    }
}
