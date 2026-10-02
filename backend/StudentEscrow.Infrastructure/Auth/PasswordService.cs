using Microsoft.AspNetCore.Identity;
using StudentEscrow.Application.Auth;

namespace StudentEscrow.Infrastructure.Auth;

public sealed class PasswordService : IPasswordService
{
    private readonly PasswordHasher<object> passwordHasher = new();
    private readonly object subject = new();

    public PasswordService()
    {
        DummyHash = Hash(Guid.NewGuid().ToString("N"));
    }

    public string DummyHash { get; }

    public string Hash(string password) => passwordHasher.HashPassword(subject, password);

    public bool Verify(string passwordHash, string password) =>
        passwordHasher.VerifyHashedPassword(subject, passwordHash, password) != PasswordVerificationResult.Failed;
}
