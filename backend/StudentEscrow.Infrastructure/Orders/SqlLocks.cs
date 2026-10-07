using Microsoft.EntityFrameworkCore;
using StudentEscrow.Infrastructure.Persistence;

namespace StudentEscrow.Infrastructure.Orders;

public static class SqlLocks
{
    // Transaction-owned locks coordinate all API/worker processes using this database.
    public static Task AcquireAsync(StudentEscrowDbContext db, string resource, CancellationToken ct) =>
        db.Database.ExecuteSqlInterpolatedAsync($"DECLARE @r int; EXEC @r = sp_getapplock @Resource={resource}, @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=10000; IF @r < 0 THROW 51000, 'Escrow lock unavailable', 1;", ct);
}
