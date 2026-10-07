using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using StudentEscrow.Domain.Orders;
using StudentEscrow.Infrastructure.Persistence;

namespace StudentEscrow.Infrastructure.Orders;

public sealed class BlockchainSync(StudentEscrowDbContext db, IBlockchainSource chain,
    BlockchainSettings settings, TimeProvider clock)
{
    public async Task SyncAsync(DeploymentManifest manifest, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await SqlLocks.AcquireAsync(db, "escrow:sync:" + manifest.DeploymentId, ct);
        var deployment = await db.Set<ChainDeployment>().FindAsync([manifest.DeploymentId], ct);
        if (deployment is null)
        {
            deployment = new ChainDeployment { Id = manifest.DeploymentId, ChainId = 31337,
                ContractAddress = manifest.ContractAddress, DeploymentBlock = manifest.DeploymentBlock,
                DeploymentBlockHash = manifest.DeploymentBlockHash, TransactionHash = manifest.TransactionHash,
                LastBlock = manifest.DeploymentBlock - 1 };
            db.Add(deployment);
        }
        if (deployment.ContractAddress != manifest.ContractAddress || deployment.DeploymentBlock != manifest.DeploymentBlock
            || deployment.DeploymentBlockHash != manifest.DeploymentBlockHash || deployment.TransactionHash != manifest.TransactionHash)
            throw new InvalidDataException("A deployment ID cannot be reused with different chain identity.");
        if (!await chain.ValidateDeploymentAsync(manifest, ct))
        {
            deployment.Status = "InvalidDeployment";
            deployment.CheckedAt = clock.GetUtcNow();
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return;
        }
        // Walk back to a common ancestor; full journal retained for this local demo.
        var ancestor = deployment.LastBlock;
        while (ancestor >= deployment.DeploymentBlock)
        {
            var saved = await db.Set<ChainBlock>().AsNoTracking().SingleOrDefaultAsync(b => b.DeploymentId == deployment.Id && b.Number == ancestor, ct);
            if (saved?.Hash == (await chain.BlockAsync(ancestor, ct))?.Hash && saved is not null) break;
            ancestor--;
        }
        if (ancestor != deployment.LastBlock)
        {
            await db.Set<ChainEvent>().Where(e => e.DeploymentId == deployment.Id && e.BlockNumber > ancestor).ExecuteDeleteAsync(ct);
            await db.Set<ChainBlock>().Where(b => b.DeploymentId == deployment.Id && b.Number > ancestor).ExecuteDeleteAsync(ct);
            await db.Set<ChainOrder>().Where(o => o.DeploymentId == deployment.Id).ExecuteDeleteAsync(ct);
            var retained = await db.Set<ChainEvent>().AsNoTracking().Where(e => e.DeploymentId == deployment.Id && e.OrderId != null)
                .OrderBy(e => e.BlockNumber).ThenBy(e => e.LogIndex).ToListAsync(ct);
            var rebuilt = new Dictionary<string, ChainOrder>();
            foreach (var ev in retained)
            {
                rebuilt.TryGetValue(ev.OrderId!, out var order);
                rebuilt[ev.OrderId!] = EscrowProjector.Apply(ev, order);
            }
            db.AddRange(rebuilt.Values);
            deployment.LastBlock = ancestor;
            deployment.LastBlockHash = ancestor >= deployment.DeploymentBlock
                ? (await chain.BlockAsync(ancestor, ct))!.Hash : "";
            await db.SaveChangesAsync(ct);
        }
        var head = await chain.HeadAsync(ct);
        var target = head - settings.Confirmations;
        var end = Math.Min(target, deployment.LastBlock + settings.BatchSize);
        for (var number = deployment.LastBlock + 1; number <= end; number++)
        {
            var block = await chain.BlockAsync(number, ct) ?? throw new IOException("Block disappeared during sync.");
            if (block.Number != number || (number == deployment.DeploymentBlock && block.Hash != deployment.DeploymentBlockHash))
                throw new IOException("Deployment block changed during sync.");
            if (number > deployment.DeploymentBlock && block.ParentHash != deployment.LastBlockHash)
                throw new IOException("Chain changed during sync; retry from checkpoint.");
            foreach (var log in await chain.LogsAsync(deployment.ContractAddress, number, ct))
            {
                if (log.Address != deployment.ContractAddress || log.BlockNumber != number || log.BlockHash != block.Hash || log.Removed)
                    throw new IOException("Log does not belong to the requested canonical block.");
                var ev = EscrowProjector.Decode(deployment.Id, log);
                if (ev is null) continue;
                db.Add(ev);
                if (ev.OrderId is not null)
                {
                    var order = await db.Set<ChainOrder>().FindAsync([deployment.Id, ev.OrderId], ct);
                    var projected = EscrowProjector.Apply(ev, order);
                    if (order is null) db.Add(projected);
                }
            }
            db.Add(new ChainBlock { DeploymentId = deployment.Id, Number = number, Hash = block.Hash });
            deployment.LastBlock = number;
            deployment.LastBlockHash = block.Hash;
        }
        if (deployment.LastBlock >= deployment.DeploymentBlock
            && (await chain.BlockAsync(deployment.LastBlock, ct))?.Hash != deployment.LastBlockHash)
            throw new IOException("Chain changed before checkpoint commit.");
        deployment.Status = deployment.LastBlock >= target ? "Ready" : "Syncing";
        deployment.CheckedAt = clock.GetUtcNow();
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
    }
}

public sealed class BlockchainWorker(IServiceScopeFactory scopes, BlockchainSettings settings,
    ManifestProvider manifests, ILogger<BlockchainWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!settings.Enabled) return;
        while (!stoppingToken.IsCancellationRequested)
        {
            DeploymentManifest? manifest = null;
            try
            {
                manifest = await manifests.ReadAsync(stoppingToken);
                await using var scope = scopes.CreateAsyncScope();
                await scope.ServiceProvider.GetRequiredService<BlockchainSync>().SyncAsync(manifest, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception exception)
            {
                logger.LogWarning(exception, "Blockchain synchronization failed; last committed checkpoint is retained.");
                if (manifest is not null)
                {
                    try
                    {
                        await using var scope = scopes.CreateAsyncScope();
                        var db = scope.ServiceProvider.GetRequiredService<StudentEscrowDbContext>();
                        await db.Set<ChainDeployment>().Where(d => d.Id == manifest.DeploymentId)
                            .ExecuteUpdateAsync(s => s.SetProperty(d => d.Status, "Unavailable"), stoppingToken);
                    }
                    catch (Exception statusError) when (!stoppingToken.IsCancellationRequested)
                    { logger.LogWarning(statusError, "Could not update synchronization availability."); }
                }
            }
            try { await Task.Delay(TimeSpan.FromSeconds(settings.PollSeconds), stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
        }
    }
}
