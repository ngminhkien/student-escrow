using Microsoft.EntityFrameworkCore;
using StudentEscrow.Domain.Orders;
using StudentEscrow.Domain.Users;

namespace StudentEscrow.Infrastructure.Orders;

public static class EscrowModel
{
    public static void Configure(ModelBuilder model)
    {
        var draft = model.Entity<OrderDraft>();
        draft.HasKey(x => x.Id);
        draft.HasIndex(x => new { x.DeploymentId, x.ClientReference }).IsUnique();
        draft.HasIndex(x => x.BuyerUserId);
        draft.HasOne<User>().WithMany().HasForeignKey(x => x.BuyerUserId).OnDelete(DeleteBehavior.Restrict);
        draft.HasOne<ChainDeployment>().WithMany().HasForeignKey(x => x.DeploymentId).OnDelete(DeleteBehavior.Restrict);
        draft.Property(x => x.Description).HasMaxLength(4000);
        draft.Property(x => x.AcceptanceCriteria).HasMaxLength(4000);
        draft.Property(x => x.StandardTermsVersion).HasMaxLength(32);
        draft.Property(x => x.Category).HasMaxLength(32);
        var risk = model.Entity<RiskAssessment>();
        risk.HasKey(x => x.Id);
        risk.HasIndex(x => new { x.DraftId, x.EvaluatedAt });
        risk.HasOne<OrderDraft>().WithMany().HasForeignKey(x => x.DraftId).OnDelete(DeleteBehavior.Restrict);
        risk.Property(x => x.Level).HasMaxLength(16);
        risk.Property(x => x.ScoringSource).HasMaxLength(16);
        risk.Property(x => x.ModelVersion).HasMaxLength(32);
        risk.Property(x => x.FeatureVersion).HasMaxLength(16);
        risk.Property(x => x.DataSource).HasMaxLength(32);
        risk.Property(x => x.FeaturesJson).HasMaxLength(1000);
        var file = model.Entity<OrderFile>();
        file.HasKey(x => x.Id);
        file.HasIndex(x => new { x.DraftId, x.Kind }).IsUnique().HasFilter("[Kind] = 'product'");
        file.HasOne<OrderDraft>().WithMany().HasForeignKey(x => x.DraftId).OnDelete(DeleteBehavior.Restrict);
        file.Property(x => x.FileName).HasMaxLength(150);
        file.Property(x => x.Kind).HasMaxLength(16);
        file.Property(x => x.Sha256).HasMaxLength(66);
        file.Property(x => x.Content).HasColumnType("varbinary(max)");
        var dep = model.Entity<ChainDeployment>();
        dep.HasKey(x => x.Id);
        dep.Property(x => x.Status).HasMaxLength(32);
        model.Entity<ChainBlock>().HasKey(x => new { x.DeploymentId, x.Number });
        var ev = model.Entity<ChainEvent>();
        ev.HasKey(x => new { x.DeploymentId, x.TransactionHash, x.LogIndex });
        ev.HasIndex(x => new { x.DeploymentId, x.BlockNumber });
        ev.HasIndex(x => new { x.DeploymentId, x.OrderId });
        ev.Property(x => x.Name).HasMaxLength(40);
        var arbiter = model.Entity<ChainArbiter>();
        arbiter.HasKey(x => new { x.DeploymentId, x.Address });
        arbiter.Property(x => x.Address).HasMaxLength(42);
        var order = model.Entity<ChainOrder>();
        order.HasKey(x => new { x.DeploymentId, x.OrderId });
        order.HasIndex(x => new { x.DeploymentId, x.Buyer, x.ClientReference }).IsUnique();
        order.Property(x => x.State).HasMaxLength(16);
        foreach (var type in new[] { typeof(OrderDraft), typeof(ChainDeployment), typeof(ChainEvent), typeof(ChainOrder), typeof(ChainBlock) })
        {
            foreach (var property in model.Entity(type).Metadata.GetProperties().Where(p => p.ClrType == typeof(string)))
            {
                if (property.Name is "Buyer" or "Seller" or "Arbiter" or "ContractAddress") property.SetMaxLength(42);
                else if (property.Name.Contains("Hash") || property.Name == "ClientReference") property.SetMaxLength(66);
                else if (property.Name.EndsWith("Wei")) property.SetMaxLength(38);
                else if (property.Name == "OrderId") property.SetMaxLength(78);
            }
        }
    }
}
