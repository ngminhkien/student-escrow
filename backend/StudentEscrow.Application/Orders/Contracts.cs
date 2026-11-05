using System.ComponentModel.DataAnnotations;
using StudentEscrow.Domain.Orders;

namespace StudentEscrow.Application.Orders;

public sealed class CreateDraftRequest
{
    [Required, EmailAddress, StringLength(254)] public string SellerEmail { get; init; } = "";
    // Must come from the platform's Arbiter list.
    [Required, StringLength(42, MinimumLength = 42)] public string Arbiter { get; init; } = "";
    [Required, StringLength(32)] public string AcceptedTermsVersion { get; init; } = "";
    [Required, StringLength(4000)] public string Description { get; init; } = "";
    [Required, StringLength(4000)] public string AcceptanceCriteria { get; init; } = "";
    [Required, RegularExpression("^[1-9][0-9]{0,37}$")] public string AmountWei { get; init; } = "";
    public long DeliveryDeadline { get; init; }
    [Range(1, 31536000)] public long ReviewWindow { get; init; }
}

public sealed class OrderActionRequest
{
    [Required, StringLength(16)] public string Action { get; init; } = "";
    public int? SellerShareBps { get; init; }
    [StringLength(32)] public string? AcceptedTermsVersion { get; init; }
}

public sealed class PartyLookupRequest
{
    [Required, EmailAddress, StringLength(254)] public string Email { get; init; } = "";
}

public sealed record PartyLookupResponse(string FullName, string MaskedEmail, string Address);
public sealed record ArbiterResponse(string FullName, string Address);
public sealed record OrderParty(string FullName, string MaskedEmail);
public sealed record OrderParties(OrderParty? Buyer, OrderParty? Seller, OrderParty? Arbiter);
public sealed record StandardTermsResponse(string Version, string Title, string Text, string Hash);

public sealed class AdminArbiterRequest
{
    [Required, StringLength(42, MinimumLength = 42)] public string Address { get; init; } = "";
    public bool Approved { get; init; }
}

public sealed record ChainActionResponse(string TransactionHash);

public sealed class AdminVerificationRequest
{
    [Required, StringLength(42, MinimumLength = 42)] public string Address { get; init; } = "";
    public bool Verified { get; init; }
}

public sealed class AdminRoleRequest
{
    [Required, StringLength(42, MinimumLength = 42)] public string Address { get; init; } = "";
    public bool Grant { get; init; }
}

public sealed class AdminCreditRequest
{
    [Required, StringLength(42, MinimumLength = 42)] public string Address { get; init; } = "";
    [Range(1, StudentEscrow.Application.Wallets.ExchangeRate.MaxCreditVnd)] public long AmountVnd { get; init; }
    // Chosen by the client once per credit, so a repeated request cannot pay twice.
    public Guid Reference { get; init; }
    [StringLength(200)] public string? Note { get; init; }
}

public sealed record AdminAccountResponse(Guid UserId, string Email, string FullName, string Address, bool Custodial,
    string BalanceWei, string BalanceVnd, string ChainBalanceWei, string KycStatus, bool VerifiedOnChain, bool ApprovedArbiter);
public sealed record AdminChainOrderResponse(string OrderId, string State, string AmountWei);
public sealed record AdminAccountsResponse(IReadOnlyList<AdminAccountResponse> Accounts, string LedgerTotalWei, string LedgerTotalVnd,
    string TreasuryWei, string ContractWei);

public sealed record FileSummary(Guid Id, string Kind, string FileName, long Length, string Sha256, DateTimeOffset CreatedAt);
public sealed record OrderView(OrderDraft Draft, ChainOrder? Chain, bool TermsMatch,
    string SyncStatus, long LastIndexedBlock, DateTimeOffset? CheckedAt, IReadOnlyList<FileSummary> Files,
    bool DeliveryFileMatchesChain, OrderParties Parties);

public interface IOrderService
{
    Task<OrderView> CreateAsync(Guid userId, CreateDraftRequest request, CancellationToken ct);
    Task<PartyLookupResponse> FindPartyAsync(Guid userId, string email, CancellationToken ct);
    Task<IReadOnlyList<ArbiterResponse>> ArbitersAsync(CancellationToken ct);
    Task<IReadOnlyList<OrderView>> ListAsync(Guid userId, int skip, CancellationToken ct);
    Task<OrderView> GetAsync(Guid userId, Guid id, CancellationToken ct);
    Task<IReadOnlyList<ChainEvent>> HistoryAsync(Guid userId, Guid id, int skip, CancellationToken ct);
    Task<FileSummary> UploadAsync(Guid userId, Guid id, string kind, string name, Stream content, CancellationToken ct);
    Task<OrderFile> DownloadAsync(Guid userId, Guid id, Guid fileId, CancellationToken ct);
}
