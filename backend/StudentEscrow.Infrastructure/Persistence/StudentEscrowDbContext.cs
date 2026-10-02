using Microsoft.EntityFrameworkCore;
using StudentEscrow.Domain.Users;

namespace StudentEscrow.Infrastructure.Persistence;

public sealed class StudentEscrowDbContext(DbContextOptions<StudentEscrowDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();

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
    }
}
