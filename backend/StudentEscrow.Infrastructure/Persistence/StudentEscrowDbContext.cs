using Microsoft.EntityFrameworkCore;
using StudentEscrow.Domain.Users;
using StudentEscrow.Domain.Wallets;
using StudentEscrow.Domain.Kyc;

namespace StudentEscrow.Infrastructure.Persistence;

public sealed class StudentEscrowDbContext(DbContextOptions<StudentEscrowDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<WalletLink> WalletLinks => Set<WalletLink>();
    public DbSet<WalletChallenge> WalletChallenges => Set<WalletChallenge>();
    public DbSet<KycSubmission> KycSubmissions => Set<KycSubmission>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
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
    }
}
