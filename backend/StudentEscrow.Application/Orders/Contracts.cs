using System.ComponentModel.DataAnnotations;
using StudentEscrow.Domain.Orders;

namespace StudentEscrow.Application.Orders;

public sealed class CreateDraftRequest
{
    [Required, StringLength(42, MinimumLength = 42)] public string Seller { get; init; } = "";
    [Required, StringLength(42, MinimumLength = 42)] public string Arbiter { get; init; } = "";
    [Required, StringLength(4000)] public string Description { get; init; } = "";
    [Required, StringLength(4000)] public string AcceptanceCriteria { get; init; } = "";
    [Required, RegularExpression("^[1-9][0-9]{0,37}$")] public string AmountWei { get; init; } = "";
    public long DeliveryDeadline { get; init; }
    [Range(1, 31536000)] public long ReviewWindow { get; init; }
}

public sealed record FileSummary(Guid Id, string Kind, string FileName, long Length, string Sha256, DateTimeOffset CreatedAt);
public sealed record OrderView(OrderDraft Draft, ChainOrder? Chain, bool TermsMatch,
    string SyncStatus, long LastIndexedBlock, DateTimeOffset? CheckedAt, IReadOnlyList<FileSummary> Files,
    bool DeliveryFileMatchesChain);

public interface IOrderService
{
    Task<OrderView> CreateAsync(Guid userId, CreateDraftRequest request, CancellationToken ct);
    Task<IReadOnlyList<OrderView>> ListAsync(Guid userId, int skip, CancellationToken ct);
    Task<OrderView> GetAsync(Guid userId, Guid id, CancellationToken ct);
    Task<IReadOnlyList<ChainEvent>> HistoryAsync(Guid userId, Guid id, int skip, CancellationToken ct);
    Task<FileSummary> UploadAsync(Guid userId, Guid id, string kind, string name, Stream content, CancellationToken ct);
    Task<OrderFile> DownloadAsync(Guid userId, Guid id, Guid fileId, CancellationToken ct);
}
