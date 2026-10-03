namespace StudentEscrow.Domain.Kyc;

public sealed class KycSubmission
{
    private KycSubmission() { }

    public KycSubmission(Guid id, Guid userId, Guid walletLinkId, string fullName, string studentNumber,
        string documentReference, string selfieReference, DateTimeOffset submittedAt)
    {
        Id = id;
        UserId = userId;
        WalletLinkId = walletLinkId;
        FullName = fullName;
        StudentNumber = studentNumber;
        DocumentReference = documentReference;
        SelfieReference = selfieReference;
        SubmittedAt = submittedAt;
    }

    public Guid Id { get; private set; }
    public Guid UserId { get; private set; }
    public Guid WalletLinkId { get; private set; }
    public string FullName { get; private set; } = string.Empty;
    public string StudentNumber { get; private set; } = string.Empty;
    public string DocumentReference { get; private set; } = string.Empty;
    public string SelfieReference { get; private set; } = string.Empty;
    public string Status { get; private set; } = "PENDING";
    public string? ReasonCode { get; private set; }
    public DateTimeOffset SubmittedAt { get; private set; }
    public DateTimeOffset? ReviewedAt { get; private set; }
    public byte[] RowVersion { get; private set; } = [];

    public void ApplyMockDecision(bool documentPassed, bool selfiePassed, DateTimeOffset reviewedAt)
    {
        if (Status != "PENDING")
        {
            throw new InvalidOperationException("Only pending submissions can be reviewed.");
        }

        Status = documentPassed && selfiePassed ? "VERIFIED" : "REJECTED";
        ReasonCode = !documentPassed ? "MOCK_DOCUMENT_FAILED" : !selfiePassed ? "MOCK_SELFIE_FAILED" : null;
        ReviewedAt = reviewedAt;
    }
}
