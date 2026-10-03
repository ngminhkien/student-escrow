using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using StudentEscrow.Application.Common;
using StudentEscrow.Application.Kyc;
using StudentEscrow.Domain.Kyc;

namespace StudentEscrow.Infrastructure.Persistence;

public sealed class KycRepository(StudentEscrowDbContext database) : IKycRepository
{
    public Task<KycSubmission?> FindAsync(Guid userId, Guid walletLinkId, CancellationToken cancellationToken) =>
        database.KycSubmissions.AsNoTracking().SingleOrDefaultAsync(
            entity => entity.UserId == userId && entity.WalletLinkId == walletLinkId, cancellationToken);

    public async Task SaveAsync(KycSubmission submission, KycSubmission? previous, CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            if (previous is not null)
            {
                if (previous.Status == "VERIFIED")
                {
                    throw new ApplicationError("KYC_ALREADY_VERIFIED", "Verified mock KYC cannot be replaced.", 409);
                }

                database.KycSubmissions.Remove(previous);
                await database.SaveChangesAsync(cancellationToken);
            }

            database.KycSubmissions.Add(submission);
            await database.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            throw Conflict();
        }
        catch (DbUpdateException exception) when (exception.InnerException is SqlException { Number: 2601 or 2627 })
        {
            throw Conflict();
        }
    }

    private static ApplicationError Conflict() => new("KYC_CONCURRENT_UPDATE", "KYC changed concurrently. Refresh and try again.", 409);
}
