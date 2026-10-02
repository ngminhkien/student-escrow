using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using StudentEscrow.Application.Auth;
using StudentEscrow.Application.Common;
using StudentEscrow.Domain.Users;

namespace StudentEscrow.Infrastructure.Persistence;

public sealed class UserRepository(StudentEscrowDbContext database) : IUserRepository
{
    public Task<User?> FindByEmailAsync(string normalizedEmail, CancellationToken cancellationToken) =>
        database.Users.AsNoTracking().SingleOrDefaultAsync(user => user.NormalizedEmail == normalizedEmail, cancellationToken);

    public Task<User?> FindByIdAsync(Guid id, CancellationToken cancellationToken) =>
        database.Users.AsNoTracking().SingleOrDefaultAsync(user => user.Id == id, cancellationToken);

    public async Task AddAsync(User user, CancellationToken cancellationToken)
    {
        database.Users.Add(user);
        try
        {
            await database.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (exception.InnerException is SqlException { Number: 2601 or 2627 })
        {
            throw new ApplicationError("EMAIL_ALREADY_EXISTS", "Email đã được đăng ký.", 409);
        }
    }
}
