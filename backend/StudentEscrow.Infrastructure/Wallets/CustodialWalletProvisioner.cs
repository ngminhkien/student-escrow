using System.Security.Cryptography;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Nethereum.Signer;
using StudentEscrow.Application.Wallets;
using StudentEscrow.Domain.Ledger;
using StudentEscrow.Domain.Wallets;
using StudentEscrow.Infrastructure.Persistence;

namespace StudentEscrow.Infrastructure.Wallets;

public sealed class CustodialWalletProvisioner(StudentEscrowDbContext db, WalletKeyVault vault, TimeProvider clock) : IWalletProvisioner
{
    public const long LocalChainId = 31337;

    public async Task EnsureAsync(Guid userId, CancellationToken cancellationToken)
    {
        if (await db.WalletLinks.AsNoTracking().AnyAsync(link => link.UserId == userId, cancellationToken)) return;
        var key = EthECKey.GenerateKey();
        var privateKey = key.GetPrivateKeyAsBytes();
        try
        {
            var address = key.GetPublicAddress().ToLowerInvariant();
            var now = clock.GetUtcNow();
            db.Add(new CustodialWallet(userId, address, vault.Protect(userId, address, privateKey), CustodialWallet.Generated, now));
            db.Add(new WalletLink(Guid.NewGuid(), userId, address, LocalChainId, now, isCustodial: true));
            db.Add(new LedgerAccount(userId, now));
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (exception.InnerException is SqlException { Number: 2601 or 2627 })
        {
            // A concurrent login for the same account created the wallet first.
            db.ChangeTracker.Clear();
        }
        finally
        {
            CryptographicOperations.ZeroMemory(privateKey);
        }
    }

    // Existing accounts keep their address, orders and KYC; only the known key is added.
    public async Task<int> ImportHardhatWalletsAsync(CancellationToken cancellationToken)
    {
        var imported = 0;
        for (var index = 0; index < HardhatKeys.AccountCount; index++)
        {
            var address = HardhatKeys.Address(index);
            var link = await db.WalletLinks.SingleOrDefaultAsync(item => item.Address == address, cancellationToken);
            if (link is null || await db.CustodialWallets.AnyAsync(item => item.UserId == link.UserId, cancellationToken)) continue;
            var privateKey = HardhatKeys.PrivateKey(index);
            try
            {
                var now = clock.GetUtcNow();
                db.Add(new CustodialWallet(link.UserId, address, vault.Protect(link.UserId, address, privateKey), CustodialWallet.HardhatImport, now));
                link.MarkCustodial();
                if (!await db.LedgerAccounts.AnyAsync(item => item.UserId == link.UserId, cancellationToken))
                    db.Add(new LedgerAccount(link.UserId, now));
                await db.SaveChangesAsync(cancellationToken);
                imported++;
            }
            finally
            {
                CryptographicOperations.ZeroMemory(privateKey);
            }
        }
        return imported;
    }
}
