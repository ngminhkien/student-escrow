using System.ComponentModel.DataAnnotations;
using StudentEscrow.Domain.Wallets;

namespace StudentEscrow.Application.Wallets;

public sealed class WalletChallengeRequest
{
    [Required, StringLength(42, MinimumLength = 42)]
    public string Address { get; init; } = string.Empty;
    public long ChainId { get; init; }
}

public sealed class WalletLinkRequest
{
    public Guid ChallengeId { get; init; }
    [Required, StringLength(132, MinimumLength = 132)]
    public string Signature { get; init; } = string.Empty;
}

public sealed record WalletChallengeResponse(Guid ChallengeId, string Address, long ChainId,
    string Message, DateTimeOffset ExpiresAt);
public sealed record WalletResponse(bool Linked, string? Address, long? ChainId, DateTimeOffset? LinkedAt);

public sealed class WalletSettings
{
    public string Domain { get; set; } = "localhost:5180";
    public string Uri { get; set; } = "http://localhost:5180";
    public long[] AllowedChainIds { get; set; } = [31337, 11155111];
    public int ChallengeLifetimeMinutes { get; set; } = 5;
}

public interface IWalletSignatureVerifier
{
    string NormalizeAddress(string address);
    string ChecksumAddress(string address);
    bool Verify(string message, string signature, string expectedAddress);
}

public interface IWalletRepository
{
    Task<WalletLink?> FindByUserAsync(Guid userId, CancellationToken cancellationToken);
    Task<WalletLink?> FindByAddressAsync(string address, CancellationToken cancellationToken);
    Task<WalletChallenge?> FindChallengeAsync(Guid id, Guid userId, CancellationToken cancellationToken);
    Task AddChallengeAsync(WalletChallenge challenge, CancellationToken cancellationToken);
    Task CompleteLinkAsync(WalletChallenge challenge, WalletLink link, DateTimeOffset now, CancellationToken cancellationToken);
}

public interface IWalletService
{
    Task<WalletResponse> GetAsync(Guid userId, CancellationToken cancellationToken);
    Task<WalletChallengeResponse> ChallengeAsync(Guid userId, WalletChallengeRequest request, CancellationToken cancellationToken);
    Task<WalletResponse> LinkAsync(Guid userId, WalletLinkRequest request, CancellationToken cancellationToken);
}
