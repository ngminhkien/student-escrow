using Nethereum.Signer;
using System.Security.Cryptography;
using StudentEscrow.Application.Auth;
using StudentEscrow.Application.Common;
using StudentEscrow.Application.Kyc;
using StudentEscrow.Application.Wallets;
using StudentEscrow.Domain.Kyc;
using StudentEscrow.Domain.Users;
using StudentEscrow.Domain.Wallets;
using StudentEscrow.Infrastructure.Wallets;
using Xunit;

namespace StudentEscrow.Application.Tests;

public sealed class WalletKycTests
{
    private readonly MemoryRepositories repository = new();
    private readonly TestClock clock = new();
    private readonly EthereumSignatureVerifier signatures = new();
    private readonly EthECKey key = EthECKey.GenerateKey();
    private readonly Guid userId = Guid.NewGuid();

    public WalletKycTests()
    {
        repository.Users.Add(new(userId, "test@example.test", "Demo Student", "test-hash", clock.GetUtcNow()));
    }

    private WalletService Wallets => new(repository, repository, signatures, new WalletSettings(), clock);
    private KycService Kyc => new(repository, repository, new KycSettings { EnableMockVerification = true }, clock);
    private Task<WalletChallengeResponse> Challenge(Guid? account = null, EthECKey? walletKey = null) =>
        Wallets.ChallengeAsync(account ?? userId, new() { Address = (walletKey ?? key).GetPublicAddress(), ChainId = 31337 }, default);
    private static string Sign(string message, EthECKey walletKey) => new EthereumMessageSigner().EncodeUTF8AndSign(message, walletKey);
    private async Task Link()
    {
        var challenge = await Challenge();
        await Wallets.LinkAsync(userId, new() { ChallengeId = challenge.ChallengeId, Signature = Sign(challenge.Message, key) }, default);
    }

    private static KycRequest Request(bool document = true, bool selfie = true) => new()
    {
        FullName = "Demo Student", StudentNumber = "DEMO-123456",
        DocumentReference = document ? "DEMO-DOCUMENT-PASS" : "DEMO-DOCUMENT-FAIL",
        SelfieReference = selfie ? "DEMO-SELFIE-PASS" : "DEMO-SELFIE-FAIL"
    };

    [Fact]
    public async Task ChallengeBindsAccountDomainChainAndUniqueNonce()
    {
        var first = await Challenge();
        var second = await Challenge();
        Assert.NotEqual(first.ChallengeId, second.ChallengeId);
        Assert.NotEqual(first.Message, second.Message);
        Assert.Contains(userId.ToString(), first.Message);
        Assert.StartsWith("localhost:5180 wants you to sign in", first.Message);
        Assert.Contains("URI: http://localhost:5180\nVersion: 1\nChain ID: 31337", first.Message);
        Assert.Equal(clock.GetUtcNow().AddMinutes(5), first.ExpiresAt);
        Assert.All(repository.Challenges, challenge => Assert.Equal(64, challenge.Nonce.Length));
    }

    [Fact]
    public async Task ValidProofLinksOnlyOnceAndProfileIsAccountScoped()
    {
        var challenge = await Challenge();
        var request = new WalletLinkRequest { ChallengeId = challenge.ChallengeId, Signature = Sign(challenge.Message, key) };
        var result = await Wallets.LinkAsync(userId, request, default);
        Assert.True(result.Linked);
        Assert.Equal(key.GetPublicAddress(), result.Address, ignoreCase: true);
        Assert.False((await Wallets.GetAsync(Guid.NewGuid(), default)).Linked);
        Assert.Equal(result, await Wallets.GetAsync(userId, default));
        var error = await Assert.ThrowsAsync<ApplicationError>(() => Wallets.LinkAsync(userId, request, default));
        Assert.Equal(409, error.StatusCode);
        Assert.Single(repository.Links);
    }

    [Fact]
    public async Task WrongKeyAndModifiedMessageDoNotConsumeChallenge()
    {
        var challenge = await Challenge();
        foreach (var signature in new[] { Sign(challenge.Message, EthECKey.GenerateKey()), Sign(challenge.Message + "tampered", key) })
        {
            var error = await Assert.ThrowsAsync<ApplicationError>(() => Wallets.LinkAsync(userId,
                new() { ChallengeId = challenge.ChallengeId, Signature = signature }, default));
            Assert.Equal("INVALID_SIGNATURE", error.Code);
        }

        Assert.Empty(repository.Consumed);
        await Wallets.LinkAsync(userId, new() { ChallengeId = challenge.ChallengeId, Signature = Sign(challenge.Message, key) }, default);
    }

    [Fact]
    public async Task AnotherAccountCannotUseChallenge()
    {
        var challenge = await Challenge();
        var error = await Assert.ThrowsAsync<ApplicationError>(() => Wallets.LinkAsync(Guid.NewGuid(),
            new() { ChallengeId = challenge.ChallengeId, Signature = Sign(challenge.Message, key) }, default));
        Assert.Equal(404, error.StatusCode);
        Assert.Empty(repository.Consumed);
    }

    [Fact]
    public async Task ExpiredChallengeIsRejectedAtExactExpiry()
    {
        var challenge = await Challenge();
        clock.Now = challenge.ExpiresAt;
        var error = await Assert.ThrowsAsync<ApplicationError>(() => Wallets.LinkAsync(userId,
            new() { ChallengeId = challenge.ChallengeId, Signature = Sign(challenge.Message, key) }, default));
        Assert.Equal("CHALLENGE_EXPIRED", error.Code);
        Assert.Empty(repository.Links);
    }

    [Fact]
    public async Task TwoAccountsCannotClaimTheSameAddressEvenWithPreissuedChallenges()
    {
        var otherUser = Guid.NewGuid();
        repository.Users.Add(new(otherUser, "other@example.test", "Other Student", "test-hash", clock.GetUtcNow()));
        var first = await Challenge();
        var second = await Challenge(otherUser);
        await Wallets.LinkAsync(userId, new() { ChallengeId = first.ChallengeId, Signature = Sign(first.Message, key) }, default);
        var error = await Assert.ThrowsAsync<ApplicationError>(() => Wallets.LinkAsync(otherUser,
            new() { ChallengeId = second.ChallengeId, Signature = Sign(second.Message, key) }, default));
        Assert.Equal("WALLET_ALREADY_LINKED", error.Code);
        Assert.Single(repository.Links);
    }

    [Fact]
    public async Task MultipleChallengesCannotReplaceLinkedWallet()
    {
        var first = await Challenge();
        var otherKey = EthECKey.GenerateKey();
        var second = await Challenge(walletKey: otherKey);
        await Wallets.LinkAsync(userId, new() { ChallengeId = first.ChallengeId, Signature = Sign(first.Message, key) }, default);
        await Assert.ThrowsAsync<ApplicationError>(() => Wallets.LinkAsync(userId,
            new() { ChallengeId = second.ChallengeId, Signature = Sign(second.Message, otherKey) }, default));
        Assert.Single(repository.Links);
    }

    [Fact]
    public async Task AtomicRepositoryRejectsConcurrentConsumption()
    {
        var response = await Challenge();
        var challenge = Assert.Single(repository.Challenges);
        var attempts = Enumerable.Range(0, 8).Select(async attempt =>
        {
            await Task.Yield();
            try
            {
                await repository.CompleteLinkAsync(challenge, new(Guid.NewGuid(), userId,
                    challenge.Address, challenge.ChainId, clock.GetUtcNow()), clock.GetUtcNow(), default);
                return true;
            }
            catch (ApplicationError) { return false; }
        });
        Assert.Single((await Task.WhenAll(attempts)).Where(success => success));
        Assert.Single(repository.Links);
        Assert.Contains(response.ChallengeId, repository.Consumed);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(0)]
    [InlineData(-1)]
    public async Task UnsupportedChainsAreRejected(long chainId)
    {
        var error = await Assert.ThrowsAsync<ApplicationError>(() => Wallets.ChallengeAsync(userId,
            new() { Address = key.GetPublicAddress(), ChainId = chainId }, default));
        Assert.Equal("UNSUPPORTED_CHAIN", error.Code);
    }

    [Theory]
    [InlineData("")]
    [InlineData("0x0000000000000000000000000000000000000000")]
    [InlineData("0xZZ00000000000000000000000000000000000000")]
    [InlineData("0x52908400098527886E0F7030069857D2E4169Ee7")]
    public void InvalidOrIncorrectChecksumAddressesAreRejected(string address) =>
        Assert.Throws<ApplicationError>(() => signatures.NormalizeAddress(address));

    [Fact]
    public void OfficialEip55VectorAndLowercaseAreAccepted()
    {
        const string checksum = "0x52908400098527886E0F7030069857D2E4169EE7";
        Assert.Equal(checksum.ToLowerInvariant(), signatures.NormalizeAddress(checksum));
        Assert.Equal(checksum, signatures.ChecksumAddress(checksum.ToLowerInvariant()));
    }

    [Fact]
    public void MalformedSignaturesDoNotThrowOrVerify()
    {
        Assert.False(signatures.Verify("message", "0x" + new string('0', 130), key.GetPublicAddress()));
        Assert.False(signatures.Verify("message", "0x" + new string('0', 128) + "1b", key.GetPublicAddress()));
        Assert.False(signatures.Verify("message", "0xBAD", key.GetPublicAddress()));
    }

    [Fact]
    public void RecoveryIdsZeroAndOneAreSupported()
    {
        var signature = Sign("StudentEscrow test", key);
        var recoveryId = Convert.ToByte(signature[^2..], 16) - 27;
        Assert.True(signatures.Verify("StudentEscrow test", signature[..^2] + recoveryId.ToString("x2"), key.GetPublicAddress()));
    }

    [Fact]
    public void RandomMalformedSignaturesCannotCrashVerification()
    {
        for (var attempt = 0; attempt < 64; attempt++)
        {
            var signature = "0x" + Convert.ToHexString(RandomNumberGenerator.GetBytes(64)) + "1b";
            Assert.False(signatures.Verify("StudentEscrow random invalid signature", signature, key.GetPublicAddress()));
        }
    }

    [Fact]
    public async Task KycRequiresWalletAndNewAccountsAreNotVerified()
    {
        Assert.Equal("NOT_SUBMITTED", (await Kyc.GetAsync(userId, default)).Status);
        var error = await Assert.ThrowsAsync<ApplicationError>(() => Kyc.SubmitAsync(userId, Request(), default));
        Assert.Equal("WALLET_REQUIRED", error.Code);
    }

    [Fact]
    public async Task PassingMockKycDoesNotClaimOnChainVerificationOrEscrowPermission()
    {
        await Link();
        var result = await Kyc.SubmitAsync(userId, Request(), default);
        Assert.Equal("VERIFIED", result.Status);
        Assert.True(result.IsMock);
        Assert.True(result.WalletLinked);
        Assert.Equal("NOT_IMPLEMENTED", result.OnChainVerificationStatus);
        Assert.False(result.CanCreateEscrow);
        Assert.Equal("DEMO-***456", result.MaskedStudentNumber);
        Assert.Equal(result, await Kyc.GetAsync(userId, default));
        Assert.Equal("NOT_SUBMITTED", (await Kyc.GetAsync(Guid.NewGuid(), default)).Status);
    }

    [Theory]
    [InlineData(false, true, "MOCK_DOCUMENT_FAILED")]
    [InlineData(true, false, "MOCK_SELFIE_FAILED")]
    [InlineData(false, false, "MOCK_DOCUMENT_FAILED")]
    public async Task RejectedMockCanBeResubmitted(bool document, bool selfie, string reason)
    {
        await Link();
        var rejected = await Kyc.SubmitAsync(userId, Request(document, selfie), default);
        Assert.Equal("REJECTED", rejected.Status);
        Assert.Equal(reason, rejected.ReasonCode);
        Assert.Equal("VERIFIED", (await Kyc.SubmitAsync(userId, Request(), default)).Status);
    }

    [Fact]
    public async Task VerifiedMockCannotBeDowngraded()
    {
        await Link();
        await Kyc.SubmitAsync(userId, Request(), default);
        var error = await Assert.ThrowsAsync<ApplicationError>(() => Kyc.SubmitAsync(userId, Request(false), default));
        Assert.Equal("KYC_ALREADY_VERIFIED", error.Code);
        Assert.Equal("VERIFIED", (await Kyc.GetAsync(userId, default)).Status);
    }

    [Fact]
    public async Task ArbitraryKycReferencesAndRealStudentNumbersAreRejected()
    {
        await Link();
        var error = await Assert.ThrowsAsync<ApplicationError>(() => Kyc.SubmitAsync(userId,
            new() { FullName = "Demo Student", StudentNumber = "123456", DocumentReference = "real-image.png", SelfieReference = "real-face.png" }, default));
        Assert.Equal("VALIDATION_ERROR", error.Code);
        Assert.Null(repository.Kyc);
    }

    [Fact]
    public async Task MockCanBeDisabled()
    {
        var service = new KycService(repository, repository, new KycSettings(), clock);
        var error = await Assert.ThrowsAsync<ApplicationError>(() => service.SubmitAsync(userId, Request(), default));
        Assert.Equal("MOCK_KYC_DISABLED", error.Code);
    }

    private sealed class TestClock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = new(2026, 10, 2, 0, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => Now;
    }

    internal sealed class MemoryRepositories : IWalletRepository, IUserRepository, IKycRepository
    {
        private readonly object gate = new();
        public List<User> Users { get; } = [];
        public List<WalletLink> Links { get; } = [];
        public List<WalletChallenge> Challenges { get; } = [];
        public HashSet<Guid> Consumed { get; } = [];
        public KycSubmission? Kyc { get; private set; }
        public Task<User?> FindByEmailAsync(string email, CancellationToken cancellationToken) =>
            Task.FromResult(Users.SingleOrDefault(user => user.NormalizedEmail == email));
        public Task<User?> FindByIdAsync(Guid id, CancellationToken cancellationToken) => Task.FromResult(Users.SingleOrDefault(user => user.Id == id));
        public Task AddAsync(User user, CancellationToken cancellationToken) { Users.Add(user); return Task.CompletedTask; }
        public Task<WalletLink?> FindByUserAsync(Guid userId, CancellationToken cancellationToken) => Task.FromResult(Links.SingleOrDefault(link => link.UserId == userId));
        public Task<WalletLink?> FindByAddressAsync(string address, CancellationToken cancellationToken) => Task.FromResult(Links.SingleOrDefault(link => link.Address == address));
        public Task<WalletChallenge?> FindChallengeAsync(Guid id, Guid userId, CancellationToken cancellationToken) =>
            Task.FromResult(Challenges.SingleOrDefault(challenge => challenge.Id == id && challenge.UserId == userId));
        public Task AddChallengeAsync(WalletChallenge challenge, CancellationToken cancellationToken) { Challenges.Add(challenge); return Task.CompletedTask; }
        public Task CompleteLinkAsync(WalletChallenge challenge, WalletLink link, DateTimeOffset now, CancellationToken cancellationToken)
        {
            lock (gate)
            {
                if (Consumed.Contains(challenge.Id) || challenge.ExpiresAt <= now)
                {
                    throw new ApplicationError("CHALLENGE_UNAVAILABLE", "Unavailable", 409);
                }

                if (Links.Any(existing => existing.UserId == link.UserId || existing.Address == link.Address))
                {
                    throw new ApplicationError("WALLET_ALREADY_LINKED", "Already linked", 409);
                }

                Consumed.Add(challenge.Id);
                Links.Add(link);
                return Task.CompletedTask;
            }
        }

        public Task<KycSubmission?> FindAsync(Guid userId, Guid walletLinkId, CancellationToken cancellationToken) =>
            Task.FromResult(Kyc?.UserId == userId && Kyc.WalletLinkId == walletLinkId ? Kyc : null);
        public Task SaveAsync(KycSubmission submission, KycSubmission? previous, CancellationToken cancellationToken)
        {
            lock (gate)
            {
                if (Kyc != previous || Kyc?.Status == "VERIFIED")
                {
                    throw new ApplicationError("KYC_CONCURRENT_UPDATE", "Concurrent update", 409);
                }

                Kyc = submission;
                return Task.CompletedTask;
            }
        }
    }
}
