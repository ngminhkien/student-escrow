using System.Globalization;
using System.Security.Cryptography;
using StudentEscrow.Application.Auth;
using StudentEscrow.Application.Common;
using StudentEscrow.Domain.Wallets;

namespace StudentEscrow.Application.Wallets;

public sealed class WalletService(IWalletRepository wallets, IUserRepository users,
    IWalletSignatureVerifier signatures, WalletSettings settings, TimeProvider clock) : IWalletService
{
    public async Task<WalletResponse> GetAsync(Guid userId, CancellationToken cancellationToken)
    {
        var wallet = await wallets.FindByUserAsync(userId, cancellationToken);
        return wallet is null ? new(false, null, null, null) : Response(wallet);
    }

    public async Task<WalletChallengeResponse> ChallengeAsync(Guid userId, WalletChallengeRequest request,
        CancellationToken cancellationToken)
    {
        var address = signatures.NormalizeAddress(request.Address);
        if (!settings.AllowedChainIds.Contains(request.ChainId))
        {
            throw new ApplicationError("UNSUPPORTED_CHAIN", "Only local Hardhat and Sepolia are supported.", 400);
        }

        if (await users.FindByIdAsync(userId, cancellationToken) is null)
        {
            throw new ApplicationError("USER_NOT_FOUND", "Account does not exist.", 404);
        }

        if (await wallets.FindByUserAsync(userId, cancellationToken) is not null
            || await wallets.FindByAddressAsync(address, cancellationToken) is not null)
        {
            throw new ApplicationError("WALLET_ALREADY_LINKED", "Account or wallet is already linked.", 409);
        }

        var now = clock.GetUtcNow();
        var expiresAt = now.AddMinutes(settings.ChallengeLifetimeMinutes);
        var id = Guid.NewGuid();
        var nonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        var checksum = signatures.ChecksumAddress(address);
        var message = $"{settings.Domain} wants you to sign in with your Ethereum account:\n{checksum}\n\n"
            + $"Link this wallet to StudentEscrow account {userId:D}. No transaction or gas is requested.\n\n"
            + $"URI: {settings.Uri}\nVersion: 1\nChain ID: {request.ChainId.ToString(CultureInfo.InvariantCulture)}\n"
            + $"Nonce: {nonce}\nIssued At: {now.ToString("O", CultureInfo.InvariantCulture)}\n"
            + $"Expiration Time: {expiresAt.ToString("O", CultureInfo.InvariantCulture)}\nRequest ID: {id:D}";
        await wallets.AddChallengeAsync(new(id, userId, address, request.ChainId, nonce, message, now, expiresAt), cancellationToken);
        return new(id, checksum, request.ChainId, message, expiresAt);
    }

    public async Task<WalletResponse> LinkAsync(Guid userId, WalletLinkRequest request, CancellationToken cancellationToken)
    {
        var challenge = await wallets.FindChallengeAsync(request.ChallengeId, userId, cancellationToken)
            ?? throw new ApplicationError("CHALLENGE_NOT_FOUND", "Challenge does not exist for this account.", 404);
        if (challenge.UsedAt is not null)
        {
            throw new ApplicationError("CHALLENGE_ALREADY_USED", "Challenge has already been used.", 409);
        }

        var now = clock.GetUtcNow();
        if (challenge.ExpiresAt <= now)
        {
            throw new ApplicationError("CHALLENGE_EXPIRED", "Challenge has expired. Request a new one.", 400);
        }

        if (!signatures.Verify(challenge.Message, request.Signature, challenge.Address))
        {
            throw new ApplicationError("INVALID_SIGNATURE", "Signature does not prove ownership of this wallet.", 400);
        }

        var link = new WalletLink(Guid.NewGuid(), userId, challenge.Address, challenge.ChainId, now);
        await wallets.CompleteLinkAsync(challenge, link, clock.GetUtcNow(), cancellationToken);
        return Response(link);
    }

    private WalletResponse Response(WalletLink link) =>
        new(true, signatures.ChecksumAddress(link.Address), link.ChainId, link.LinkedAt);
}
