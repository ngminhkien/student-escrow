namespace StudentEscrow.Domain.Users;

public sealed class User
{
    private User() { }

    public User(Guid id, string email, string fullName, string passwordHash, DateTimeOffset createdAt)
    {
        Id = id;
        Email = email;
        NormalizedEmail = email.ToUpperInvariant();
        FullName = fullName;
        PasswordHash = passwordHash;
        CreatedAt = createdAt;
    }

    public Guid Id { get; private set; }
    public string Email { get; private set; } = string.Empty;
    public string NormalizedEmail { get; private set; } = string.Empty;
    public string FullName { get; private set; } = string.Empty;
    public string PasswordHash { get; private set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; private set; }
}
