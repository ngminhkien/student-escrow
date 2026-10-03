using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using StudentEscrow.Application.Common;
using StudentEscrow.Application.Wallets;
using StudentEscrow.Domain.Wallets;

namespace StudentEscrow.Infrastructure.Persistence;

public sealed class WalletRepository(StudentEscrowDbContext database) : IWalletRepository
{
    public Task<WalletLink?> FindByUserAsync(Guid userId, CancellationToken cancellationToken) =>
        database.WalletLinks.AsNoTracking().SingleOrDefaultAsync(entity => entity.UserId == userId, cancellationToken);

    public Task<WalletLink?> FindByAddressAsync(string address, CancellationToken cancellationToken) =>
        database.WalletLinks.AsNoTracking().SingleOrDefaultAsync(entity => entity.Address == address, cancellationToken);

    public Task<WalletChallenge?> FindChallengeAsync(Guid id, Guid userId, CancellationToken cancellationToken) =>
        database.WalletChallenges.AsNoTracking().SingleOrDefaultAsync(
            entity => entity.Id == id && entity.UserId == userId, cancellationToken);

    public async Task AddChallengeAsync(WalletChallenge challenge, CancellationToken cancellationToken)
    {
        database.WalletChallenges.Add(challenge);
        await database.SaveChangesAsync(cancellationToken);
    }

    public async Task CompleteLinkAsync(WalletChallenge challenge, WalletLink link, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var consumed = await database.WalletChallenges.Where(entity => entity.Id == challenge.Id
            && entity.UserId == link.UserId && entity.Address == link.Address && entity.ChainId == link.ChainId
            && entity.UsedAt == null && entity.ExpiresAt > now)
            .ExecuteUpdateAsync(setters => setters.SetProperty(entity => entity.UsedAt, (DateTimeOffset?)now), cancellationToken);
        if (consumed != 1)
        {
            throw new ApplicationError("CHALLENGE_UNAVAILABLE", "Challenge has expired or has already been used.", 409);
        }

        database.WalletLinks.Add(link);
        try
        {
            await database.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (exception.InnerException is SqlException { Number: 2601 or 2627 })
        {
            throw new ApplicationError("WALLET_ALREADY_LINKED", "Account or wallet is already linked.", 409);
        }
    }
}
