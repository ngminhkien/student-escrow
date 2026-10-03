using System.ComponentModel.DataAnnotations;
using StudentEscrow.Domain.Kyc;

namespace StudentEscrow.Application.Kyc;

public sealed class KycRequest
{
    [Required, StringLength(100, MinimumLength = 2)]
    public string FullName { get; init; } = string.Empty;
    [Required, RegularExpression("^DEMO-[A-Z0-9-]{3,24}$")]
    public string StudentNumber { get; init; } = string.Empty;
    [Required, StringLength(32)]
    public string DocumentReference { get; init; } = string.Empty;
    [Required, StringLength(32)]
    public string SelfieReference { get; init; } = string.Empty;
}

public sealed record KycResponse(string Status, bool IsMock, bool WalletLinked, string? WalletAddress,
    string? MaskedStudentNumber, string? ReasonCode, DateTimeOffset? SubmittedAt, DateTimeOffset? ReviewedAt,
    string OnChainVerificationStatus = "NOT_IMPLEMENTED", bool CanCreateEscrow = false);

public sealed class KycSettings
{
    public bool EnableMockVerification { get; set; }
}

public interface IKycRepository
{
    Task<KycSubmission?> FindAsync(Guid userId, Guid walletLinkId, CancellationToken cancellationToken);
    Task SaveAsync(KycSubmission submission, KycSubmission? previous, CancellationToken cancellationToken);
}

public interface IKycService
{
    Task<KycResponse> GetAsync(Guid userId, CancellationToken cancellationToken);
    Task<KycResponse> SubmitAsync(Guid userId, KycRequest request, CancellationToken cancellationToken);
}
