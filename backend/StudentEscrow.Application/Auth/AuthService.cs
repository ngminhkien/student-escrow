using System.ComponentModel.DataAnnotations;
using StudentEscrow.Application.Common;
using StudentEscrow.Domain.Users;

namespace StudentEscrow.Application.Auth;

public sealed class AuthService(
    IUserRepository users,
    IPasswordService passwords,
    ITokenService tokens,
    TimeProvider timeProvider) : IAuthService
{
    public async Task<AuthResponse> RegisterAsync(RegisterRequest request, CancellationToken cancellationToken)
    {
        Validate(request);
        var email = request.Email.Trim();
        var fullName = request.FullName.Trim();
        if (fullName.Length < 2)
        {
            throw new ApplicationError("VALIDATION_ERROR", "Họ tên phải có ít nhất 2 ký tự.", 400);
        }

        if (await users.FindByEmailAsync(email.ToUpperInvariant(), cancellationToken) is not null)
        {
            throw new ApplicationError("EMAIL_ALREADY_EXISTS", "Email đã được đăng ký.", 409);
        }

        var user = new User(Guid.NewGuid(), email, fullName, passwords.Hash(request.Password), timeProvider.GetUtcNow());
        await users.AddAsync(user, cancellationToken);
        return tokens.Issue(user);
    }

    public async Task<AuthResponse> LoginAsync(LoginRequest request, CancellationToken cancellationToken)
    {
        Validate(request);
        var user = await users.FindByEmailAsync(request.Email.Trim().ToUpperInvariant(), cancellationToken);
        var passwordMatches = passwords.Verify(user?.PasswordHash ?? passwords.DummyHash, request.Password);
        if (user is null || !passwordMatches)
        {
            throw new ApplicationError("INVALID_CREDENTIALS", "Email hoặc mật khẩu không đúng.", 401);
        }

        return tokens.Issue(user);
    }

    public async Task<UserResponse> GetProfileAsync(Guid userId, CancellationToken cancellationToken)
    {
        var user = await users.FindByIdAsync(userId, cancellationToken)
            ?? throw new ApplicationError("USER_NOT_FOUND", "Tài khoản không tồn tại.", 404);
        return UserResponse.FromUser(user);
    }

    private static void Validate(object request)
    {
        var results = new List<ValidationResult>();
        if (!Validator.TryValidateObject(request, new ValidationContext(request), results, true))
        {
            throw new ApplicationError("VALIDATION_ERROR", "Dữ liệu không hợp lệ. Kiểm tra email, họ tên và độ dài mật khẩu.", 400);
        }
    }
}
