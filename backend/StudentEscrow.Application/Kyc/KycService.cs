using System.ComponentModel.DataAnnotations;
using StudentEscrow.Application.Common;
using StudentEscrow.Application.Wallets;
using StudentEscrow.Domain.Kyc;
using StudentEscrow.Domain.Wallets;

namespace StudentEscrow.Application.Kyc;

public sealed class KycService(IKycRepository kyc, IWalletRepository wallets, KycSettings settings,
    TimeProvider clock) : IKycService
{
    public async Task<KycResponse> GetAsync(Guid userId, CancellationToken cancellationToken)
    {
        var wallet = await wallets.FindByUserAsync(userId, cancellationToken);
        var submission = wallet is null ? null : await kyc.FindAsync(userId, wallet.Id, cancellationToken);
        return Response(wallet, submission);
    }

    public async Task<KycResponse> SubmitAsync(Guid userId, KycRequest request, CancellationToken cancellationToken)
    {
        if (!settings.EnableMockVerification)
        {
            throw new ApplicationError("MOCK_KYC_DISABLED", "Mock KYC is disabled.", 503);
        }

        if (!Validator.TryValidateObject(request, new ValidationContext(request), [], true)
            || string.IsNullOrWhiteSpace(request.FullName) || request.FullName.Trim().Length < 2
            || request.DocumentReference is not ("DEMO-DOCUMENT-PASS" or "DEMO-DOCUMENT-FAIL")
            || request.SelfieReference is not ("DEMO-SELFIE-PASS" or "DEMO-SELFIE-FAIL"))
        {
            throw new ApplicationError("VALIDATION_ERROR", "Use demo student numbers and the documented fixture references only.", 400);
        }

        var wallet = await wallets.FindByUserAsync(userId, cancellationToken)
            ?? throw new ApplicationError("WALLET_REQUIRED", "Link a wallet before submitting mock KYC.", 409);
        var previous = await kyc.FindAsync(userId, wallet.Id, cancellationToken);
        if (previous?.Status == "VERIFIED")
        {
            throw new ApplicationError("KYC_ALREADY_VERIFIED", "Verified mock KYC cannot be replaced by the user.", 409);
        }

        var submission = new KycSubmission(Guid.NewGuid(), userId, wallet.Id, request.FullName.Trim(),
            request.StudentNumber, request.DocumentReference, request.SelfieReference, clock.GetUtcNow());
        submission.ApplyMockDecision(request.DocumentReference == "DEMO-DOCUMENT-PASS",
            request.SelfieReference == "DEMO-SELFIE-PASS", clock.GetUtcNow());
        await kyc.SaveAsync(submission, previous, cancellationToken);
        return Response(wallet, submission);
    }

    private static KycResponse Response(WalletLink? wallet, KycSubmission? submission) => new(
        submission?.Status ?? "NOT_SUBMITTED", true, wallet is not null, wallet?.Address,
        submission is null ? null : "DEMO-***" + submission.StudentNumber[^3..],
        submission?.ReasonCode, submission?.SubmittedAt, submission?.ReviewedAt);
}
