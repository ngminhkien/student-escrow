using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using StudentEscrow.Application.Common;
using StudentEscrow.Application.Orders;
using StudentEscrow.Application.Wallets;
using StudentEscrow.Domain.Orders;
using StudentEscrow.Domain.Wallets;
using StudentEscrow.Infrastructure.Persistence;

namespace StudentEscrow.Infrastructure.Orders;

public sealed class OrderService(StudentEscrowDbContext db, IWalletSignatureVerifier addresses,
    ManifestProvider manifests, BlockchainSettings settings, TimeProvider clock) : IOrderService
{
    private static ApplicationError Missing() => new("ORDER_NOT_FOUND", "Order or file not found.", 404);
    private async Task<WalletLink> Wallet(Guid userId, CancellationToken ct) =>
        await db.WalletLinks.AsNoTracking().SingleOrDefaultAsync(w => w.UserId == userId, ct)
        ?? throw new ApplicationError("WALLET_REQUIRED", "Link a wallet before using orders.", 409);
    private async Task<ChainDeployment> Active(CancellationToken ct)
    {
        if (!settings.Enabled) throw new ApplicationError("BLOCKCHAIN_DISABLED", "Enable the local blockchain worker first.", 503);
        DeploymentManifest manifest;
        try { manifest = await manifests.ReadAsync(ct); }
        catch (Exception ex) when (ex is IOException or InvalidDataException or InvalidOperationException or System.Text.Json.JsonException)
        { throw new ApplicationError("DEPLOYMENT_UNAVAILABLE", "Deploy the local contract and wait for synchronization.", 503); }
        var deployment = await db.Set<ChainDeployment>().AsNoTracking().SingleOrDefaultAsync(d => d.Id == manifest.DeploymentId, ct);
        if (deployment is null || FreshStatus(deployment) != "Ready" || deployment.ContractAddress != manifest.ContractAddress
            || deployment.DeploymentBlockHash != manifest.DeploymentBlockHash || deployment.TransactionHash != manifest.TransactionHash)
            throw new ApplicationError("CHAIN_NOT_READY", "Wait for the blockchain worker or check the local deployment.", 503);
        return deployment;
    }
    private string FreshStatus(ChainDeployment d) => d.CheckedAt is null || clock.GetUtcNow() - d.CheckedAt > TimeSpan.FromSeconds(30)
        ? "Stale" : d.Status;
    private async Task<OrderDraft> Authorized(Guid userId, Guid id, CancellationToken ct)
    {
        var draft = await db.Set<OrderDraft>().AsNoTracking().SingleOrDefaultAsync(d => d.Id == id, ct) ?? throw Missing();
        var wallet = await Wallet(userId, ct);
        var deployment = await db.Set<ChainDeployment>().AsNoTracking().SingleAsync(d => d.Id == draft.DeploymentId, ct);
        if (wallet.ChainId != deployment.ChainId || (wallet.Address != draft.Buyer && wallet.Address != draft.Seller && wallet.Address != draft.Arbiter))
            throw Missing();
        return draft;
    }
    public async Task<OrderView> CreateAsync(Guid userId, CreateDraftRequest request, CancellationToken ct)
    {
        OrderRules.Validate(request, clock.GetUtcNow().ToUnixTimeSeconds());
        var deployment = await Active(ct);
        var buyer = await Wallet(userId, ct);
        var seller = (await Party(request.SellerEmail, deployment.ChainId, ct)).Address;
        var arbiter = addresses.NormalizeAddress(request.Arbiter);
        if (!await db.Set<ChainArbiter>().AsNoTracking().AnyAsync(a => a.DeploymentId == deployment.Id && a.Address == arbiter && a.Approved, ct))
            throw new ApplicationError("ARBITER_NOT_APPROVED", "Arbiter phải nằm trong danh sách do nền tảng quản lý.", 400);
        if (buyer.ChainId != deployment.ChainId || new[] { buyer.Address, seller, arbiter }.Distinct().Count() != 3
            || seller == deployment.ContractAddress || arbiter == deployment.ContractAddress)
            throw new ApplicationError("INVALID_PARTIES", "Use three different wallets on the configured chain.", 400);
        var draft = new OrderDraft { Id = Guid.NewGuid(), BuyerUserId = userId, DeploymentId = deployment.Id,
            Buyer = buyer.Address, Seller = seller, Arbiter = arbiter, AmountWei = request.AmountWei,
            Description = request.Description.Trim(), AcceptanceCriteria = request.AcceptanceCriteria.Trim(),
            DeliveryDeadline = request.DeliveryDeadline, ReviewWindow = request.ReviewWindow,
            ClientReference = "0x" + Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32)), CreatedAt = clock.GetUtcNow(),
            StandardTermsVersion = StandardTerms.Current.Version, BuyerAcceptedTermsAt = clock.GetUtcNow() };
        OrderRules.Seal(draft, deployment.ChainId, deployment.ContractAddress);
        db.Add(draft);
        await db.SaveChangesAsync(ct);
        return await View(draft, ct);
    }
    public async Task<PartyLookupResponse> FindPartyAsync(Guid userId, string email, CancellationToken ct)
    {
        var deployment = await Active(ct);
        var party = await Party(email, deployment.ChainId, ct);
        if (party.UserId == userId) throw new ApplicationError("INVALID_PARTIES", "Bạn không thể tự giao dịch với chính mình.", 400);
        return new(party.FullName, Mask(party.Email), addresses.ChecksumAddress(party.Address));
    }
    private async Task<(Guid UserId, string FullName, string Email, string Address)> Party(string email, long chainId, CancellationToken ct)
    {
        var normalized = email.Trim().ToUpperInvariant();
        var row = await (from user in db.Users.AsNoTracking()
                         join link in db.WalletLinks.AsNoTracking() on user.Id equals link.UserId
                         where user.NormalizedEmail == normalized && link.ChainId == chainId
                         select new { user.Id, user.FullName, user.Email, link.Address }).SingleOrDefaultAsync(ct)
            ?? throw new ApplicationError("PARTY_NOT_FOUND", "Không tìm thấy tài khoản có ví với email này.", 404);
        return (row.Id, row.FullName, row.Email, row.Address);
    }
    // Enough for the other party to recognise an account, without handing out its full address.
    private static string Mask(string email)
    {
        var at = email.IndexOf('@');
        return at <= 0 ? "***" : email[..Math.Min(2, at)] + "***" + email[at..];
    }
    public async Task<IReadOnlyList<ArbiterResponse>> ArbitersAsync(CancellationToken ct)
    {
        var deployment = await Active(ct);
        var rows = await (from arbiter in db.Set<ChainArbiter>().AsNoTracking()
                          join link in db.WalletLinks.AsNoTracking() on arbiter.Address equals link.Address
                          join user in db.Users.AsNoTracking() on link.UserId equals user.Id
                          where arbiter.DeploymentId == deployment.Id && arbiter.Approved
                          orderby user.FullName
                          select new { user.FullName, arbiter.Address }).ToListAsync(ct);
        return rows.Select(row => new ArbiterResponse(row.FullName, addresses.ChecksumAddress(row.Address))).ToList();
    }
    private async Task<OrderParties> Parties(OrderDraft draft, CancellationToken ct)
    {
        string[] wallets = [draft.Buyer, draft.Seller, draft.Arbiter];
        var rows = await (from link in db.WalletLinks.AsNoTracking()
                          join user in db.Users.AsNoTracking() on link.UserId equals user.Id
                          where wallets.Contains(link.Address)
                          select new { link.Address, user.FullName, user.Email }).ToListAsync(ct);
        OrderParty? Find(string address) => rows.Where(row => row.Address == address)
            .Select(row => new OrderParty(row.FullName, Mask(row.Email))).FirstOrDefault();
        return new(Find(draft.Buyer), Find(draft.Seller), Find(draft.Arbiter));
    }
    public async Task<IReadOnlyList<OrderView>> ListAsync(Guid userId, int skip, CancellationToken ct)
    {
        var wallet = await Wallet(userId, ct);
        var drafts = await db.Set<OrderDraft>().AsNoTracking().Where(d =>
            (d.Buyer == wallet.Address || d.Seller == wallet.Address || d.Arbiter == wallet.Address)
            && db.Set<ChainDeployment>().Any(dep => dep.Id == d.DeploymentId && dep.ChainId == wallet.ChainId))
            .OrderByDescending(d => d.CreatedAt).ThenBy(d => d.Id).Skip(Math.Max(0, skip)).Take(50).ToListAsync(ct);
        var result = new List<OrderView>();
        foreach (var draft in drafts) result.Add(await View(draft, ct));
        return result;
    }
    public async Task<OrderView> GetAsync(Guid userId, Guid id, CancellationToken ct) => await View(await Authorized(userId, id, ct), ct);
    private async Task<OrderView> View(OrderDraft draft, CancellationToken ct)
    {
        var chain = await db.Set<ChainOrder>().AsNoTracking().SingleOrDefaultAsync(o => o.DeploymentId == draft.DeploymentId
            && o.Buyer == draft.Buyer && o.ClientReference == draft.ClientReference, ct);
        var deployment = await db.Set<ChainDeployment>().AsNoTracking().SingleAsync(d => d.Id == draft.DeploymentId, ct);
        var files = await db.Set<OrderFile>().AsNoTracking().Where(f => f.DraftId == draft.Id).OrderBy(f => f.CreatedAt)
            .Select(f => new FileSummary(f.Id, f.Kind, f.FileName, f.Length, f.Sha256, f.CreatedAt)).ToListAsync(ct);
        var matches = chain is not null && OrderRules.Matches(draft, chain);
        var status = settings.Enabled ? FreshStatus(deployment) : "Disabled";
        if (settings.Enabled)
        {
            try { if ((await manifests.ReadAsync(ct)).DeploymentId != deployment.Id) status = "Archived"; }
            catch (Exception ex) when (ex is IOException or InvalidDataException or InvalidOperationException or System.Text.Json.JsonException) { status = "Unavailable"; }
        }
        return new(draft, chain, matches, status, deployment.LastBlock, deployment.CheckedAt, files,
            matches && chain!.DeliveryHash is not null && files.Any(f => f.Kind == "product" && f.Sha256 == chain.DeliveryHash),
            await Parties(draft, ct));
    }
    public async Task<IReadOnlyList<ChainEvent>> HistoryAsync(Guid userId, Guid id, int skip, CancellationToken ct)
    {
        var view = await GetAsync(userId, id, ct);
        if (view.Chain is null) return [];
        return await db.Set<ChainEvent>().AsNoTracking().Where(e => e.DeploymentId == view.Draft.DeploymentId && e.OrderId == view.Chain.OrderId)
            .OrderBy(e => e.BlockNumber).ThenBy(e => e.LogIndex).Skip(Math.Max(0, skip)).Take(100).ToListAsync(ct);
    }
    public async Task<FileSummary> UploadAsync(Guid userId, Guid id, string kind, string name, Stream content, CancellationToken ct)
    {
        var draft = await Authorized(userId, id, ct);
        var wallet = await Wallet(userId, ct);
        if ((kind == "product" && wallet.Address != draft.Seller)
            || (kind == "evidence" && wallet.Address != draft.Buyer && wallet.Address != draft.Seller))
            throw new ApplicationError("FORBIDDEN", "Only the seller uploads the product; buyer/seller upload evidence.", 403);
        var deployment = await Active(ct);
        if (deployment.Id != draft.DeploymentId) throw new ApplicationError("OLD_DEPLOYMENT", "This order belongs to a previous deployment.", 409);
        var safeName = Path.GetFileName(name.Replace('\\', '/'));
        if (string.IsNullOrWhiteSpace(safeName) || safeName.Length > 150 || safeName.Any(char.IsControl))
            throw new ApplicationError("INVALID_FILENAME", "Use a filename of 1-150 characters.", 400);
        var bytes = await OrderRules.ReadFileAsync(content, kind, safeName, ct);
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await SqlLocks.AcquireAsync(db, "escrow:files:" + id, ct);
        var view = await View(draft, ct);
        if (!view.TermsMatch || view.SyncStatus != "Ready" || (kind == "product" ? view.Chain!.State != "Funded"
            : view.Chain!.State is not ("Funded" or "Delivered" or "Disputed")))
            throw new ApplicationError("INVALID_ORDER_STATE", "Wait for matching on-chain terms and an active funded order.", 409);
        OrderRules.CheckQuota(view.Files.Select(f => (f.Kind, f.Length)), kind, bytes.Length);
        var file = new OrderFile { Id = Guid.NewGuid(), DraftId = id, UploadedBy = userId, Kind = kind, FileName = safeName,
            Content = bytes, Length = bytes.Length, Sha256 = OrderRules.Hash(bytes), CreatedAt = clock.GetUtcNow() };
        db.Add(file);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return new(file.Id, file.Kind, file.FileName, file.Length, file.Sha256, file.CreatedAt);
    }
    public async Task<OrderFile> DownloadAsync(Guid userId, Guid id, Guid fileId, CancellationToken ct)
    {
        var draft = await Authorized(userId, id, ct);
        var file = await db.Set<OrderFile>().AsNoTracking().SingleOrDefaultAsync(f => f.Id == fileId && f.DraftId == id, ct) ?? throw Missing();
        if (file.Kind == "product" && !await CanReadProduct(draft, (await Wallet(userId, ct)).Address, ct))
            throw new ApplicationError("PRODUCT_NOT_DELIVERED", "Sản phẩm chỉ mở sau khi Seller xác nhận bàn giao trên blockchain.", 403);
        return file;
    }
    // Otherwise a Buyer could take the uploaded product before delivery, then still refund or dispute the escrow.
    private async Task<bool> CanReadProduct(OrderDraft draft, string address, CancellationToken ct)
    {
        if (address == draft.Seller) return true;
        var chain = await db.Set<ChainOrder>().AsNoTracking().SingleOrDefaultAsync(o => o.DeploymentId == draft.DeploymentId
            && o.Buyer == draft.Buyer && o.ClientReference == draft.ClientReference, ct);
        return chain?.DeliveryHash is not null || (address == draft.Arbiter && chain?.State == "Disputed");
    }
}
