using Microsoft.EntityFrameworkCore;
using StudentEscrow.Domain.Kyc;
using StudentEscrow.Domain.Wallets;
using StudentEscrow.Infrastructure.Persistence;
using Xunit;

namespace StudentEscrow.Application.Tests;

public sealed class WalletKycSchemaTests
{
    private static StudentEscrowDbContext Database() => new(new DbContextOptionsBuilder<StudentEscrowDbContext>()
        .UseSqlServer("Server=localhost;Database=SchemaTestOnly;Integrated Security=True;Encrypt=False").Options);

    [Fact]
    public void WalletAddressAndUserHaveUniqueIndexes()
    {
        using var database = Database();
        var wallet = database.Model.FindEntityType(typeof(WalletLink))!;
        Assert.Contains(wallet.GetIndexes(), index => index.IsUnique && index.Properties.Single().Name == nameof(WalletLink.Address));
        Assert.Contains(wallet.GetIndexes(), index => index.IsUnique && index.Properties.Single().Name == nameof(WalletLink.UserId));
        Assert.All(wallet.GetForeignKeys(), relation => Assert.Equal(DeleteBehavior.Restrict, relation.DeleteBehavior));
    }

    [Fact]
    public void KycHasUniqueWalletAndSqlRowVersionConcurrencyToken()
    {
        using var database = Database();
        var kyc = database.Model.FindEntityType(typeof(KycSubmission))!;
        Assert.Contains(kyc.GetIndexes(), index => index.IsUnique && index.Properties.Single().Name == nameof(KycSubmission.WalletLinkId));
        var version = kyc.FindProperty(nameof(KycSubmission.RowVersion))!;
        Assert.True(version.IsConcurrencyToken);
        Assert.Equal("rowversion", version.GetColumnType());
    }

    [Fact]
    public void CheckedInMigrationsMatchCurrentSqlModelWithoutConnectingToDatabase()
    {
        using var database = Database();
        Assert.False(database.Database.HasPendingModelChanges());
        Assert.Contains("20261002065603_WalletProofAndMockKyc", database.Database.GetMigrations());
    }
}
