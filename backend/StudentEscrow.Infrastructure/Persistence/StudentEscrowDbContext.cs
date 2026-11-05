using Microsoft.EntityFrameworkCore;
using StudentEscrow.Domain.Users;
using StudentEscrow.Domain.Wallets;
using StudentEscrow.Domain.Kyc;
using StudentEscrow.Domain.Ledger;

namespace StudentEscrow.Infrastructure.Persistence;

public sealed class StudentEscrowDbContext(DbContextOptions<StudentEscrowDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<WalletLink> WalletLinks => Set<WalletLink>();
    public DbSet<WalletChallenge> WalletChallenges => Set<WalletChallenge>();
    public DbSet<KycSubmission> KycSubmissions => Set<KycSubmission>();
    public DbSet<CustodialWallet> CustodialWallets => Set<CustodialWallet>();
    public DbSet<LedgerAccount> LedgerAccounts => Set<LedgerAccount>();
    public DbSet<LedgerEntry> LedgerEntries => Set<LedgerEntry>();
    public DbSet<DepositRequest> DepositRequests => Set<DepositRequest>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        StudentEscrow.Infrastructure.Orders.EscrowModel.Configure(modelBuilder);
        var user = modelBuilder.Entity<User>();
        user.ToTable("Users");
        user.HasKey(entity => entity.Id);
        user.Property(entity => entity.Email).HasMaxLength(254).IsRequired();
        user.Property(entity => entity.NormalizedEmail).HasMaxLength(254).IsRequired();
        user.HasIndex(entity => entity.NormalizedEmail).IsUnique();
        user.Property(entity => entity.FullName).HasMaxLength(100).IsRequired();
        user.Property(entity => entity.PasswordHash).HasMaxLength(512).IsRequired();
        user.Property(entity => entity.CreatedAt).IsRequired();

        var wallet = modelBuilder.Entity<WalletLink>();
        wallet.ToTable("WalletLinks");
        wallet.HasKey(entity => entity.Id);
        wallet.Property(entity => entity.Address).HasMaxLength(42).IsRequired();
        wallet.HasIndex(entity => entity.UserId).IsUnique();
        wallet.HasIndex(entity => entity.Address).IsUnique();
        wallet.HasOne<User>().WithMany().HasForeignKey(entity => entity.UserId).OnDelete(DeleteBehavior.Restrict);

        var challenge = modelBuilder.Entity<WalletChallenge>();
        challenge.ToTable("WalletChallenges");
        challenge.HasKey(entity => entity.Id);
        challenge.Property(entity => entity.Address).HasMaxLength(42).IsRequired();
        challenge.Property(entity => entity.Nonce).HasMaxLength(64).IsRequired();
        challenge.Property(entity => entity.Message).HasMaxLength(2048).IsRequired();
        challenge.HasIndex(entity => new { entity.UserId, entity.ExpiresAt });
        challenge.HasOne<User>().WithMany().HasForeignKey(entity => entity.UserId).OnDelete(DeleteBehavior.Restrict);

        var kyc = modelBuilder.Entity<KycSubmission>();
        kyc.ToTable("KycSubmissions");
        kyc.HasKey(entity => entity.Id);
        kyc.Property(entity => entity.FullName).HasMaxLength(100).IsRequired();
        kyc.Property(entity => entity.StudentNumber).HasMaxLength(29).IsRequired();
        kyc.Property(entity => entity.DocumentReference).HasMaxLength(32).IsRequired();
        kyc.Property(entity => entity.SelfieReference).HasMaxLength(32).IsRequired();
        kyc.Property(entity => entity.Status).HasMaxLength(16).IsRequired();
        kyc.Property(entity => entity.ReasonCode).HasMaxLength(64);
        kyc.Property(entity => entity.RowVersion).IsRowVersion();
        kyc.HasIndex(entity => entity.WalletLinkId).IsUnique();
        kyc.HasOne<User>().WithMany().HasForeignKey(entity => entity.UserId).OnDelete(DeleteBehavior.Restrict);
        kyc.HasOne<WalletLink>().WithMany().HasForeignKey(entity => entity.WalletLinkId).OnDelete(DeleteBehavior.Restrict);

        var custodial = modelBuilder.Entity<CustodialWallet>();
        custodial.ToTable("CustodialWallets");
        custodial.HasKey(entity => entity.UserId);
        custodial.Property(entity => entity.Address).HasMaxLength(42).IsRequired();
        custodial.Property(entity => entity.EncryptedPrivateKey).HasMaxLength(128).IsRequired();
        custodial.Property(entity => entity.Source).HasMaxLength(16).IsRequired();
        custodial.HasIndex(entity => entity.Address).IsUnique();
        custodial.HasOne<User>().WithOne().HasForeignKey<CustodialWallet>(entity => entity.UserId).OnDelete(DeleteBehavior.Restrict);

        var account = modelBuilder.Entity<LedgerAccount>();
        account.ToTable("LedgerAccounts");
        account.HasKey(entity => entity.UserId);
        account.Property(entity => entity.BalanceWei).HasPrecision(38, 0);
        account.HasOne<User>().WithOne().HasForeignKey<LedgerAccount>(entity => entity.UserId).OnDelete(DeleteBehavior.Restrict);

        var deposit = modelBuilder.Entity<DepositRequest>();
        deposit.ToTable("DepositRequests");
        deposit.HasKey(item => item.Id);
        deposit.Property(item => item.Gateway).HasMaxLength(24).IsRequired();
        deposit.Property(item => item.Status).HasMaxLength(16).IsRequired();
        deposit.Property(item => item.GatewayTransactionId).HasMaxLength(64);
        deposit.Property(item => item.PayoutAddress).HasMaxLength(42);
        deposit.Property(item => item.PayoutStatus).HasMaxLength(16);
        deposit.Property(item => item.PayoutTransactionHash).HasMaxLength(66);
        deposit.HasIndex(item => new { item.UserId, item.Reference }).IsUnique();
        deposit.HasIndex(item => new { item.UserId, item.CreatedAt });
        // One payment at the gateway can settle only one request.
        deposit.HasIndex(item => new { item.Gateway, item.GatewayTransactionId }).IsUnique().HasFilter("[GatewayTransactionId] IS NOT NULL");
        deposit.HasOne<User>().WithMany().HasForeignKey(item => item.UserId).OnDelete(DeleteBehavior.Restrict);

        var entry = modelBuilder.Entity<LedgerEntry>();
        entry.ToTable("LedgerEntries");
        entry.HasKey(item => item.Id);
        entry.Property(item => item.Type).HasMaxLength(24).IsRequired();
        entry.Property(item => item.AmountWei).HasPrecision(38, 0);
        entry.Property(item => item.BalanceAfterWei).HasPrecision(38, 0);
        entry.Property(item => item.IdempotencyKey).HasMaxLength(256).IsRequired();
        entry.Property(item => item.OrderId).HasMaxLength(78);
        entry.Property(item => item.TransactionHash).HasMaxLength(66);
        entry.Property(item => item.Note).HasMaxLength(200);
        entry.HasIndex(item => item.IdempotencyKey).IsUnique();
        entry.HasIndex(item => new { item.UserId, item.CreatedAt });
        entry.HasIndex(item => new { item.DeploymentId, item.BlockNumber });
        entry.HasOne<User>().WithMany().HasForeignKey(item => item.UserId).OnDelete(DeleteBehavior.Restrict);
    }
}
