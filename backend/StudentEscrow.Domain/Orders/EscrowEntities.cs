namespace StudentEscrow.Domain.Orders;

// Off-chain terms are immutable. Chain projections can always be rebuilt from the journal.
public sealed class OrderDraft
{
    public Guid Id { get; set; }
    public Guid BuyerUserId { get; set; }
    public Guid DeploymentId { get; set; }
    public string Buyer { get; set; } = "";
    public string Seller { get; set; } = "";
    public string Arbiter { get; set; } = "";
    public string Description { get; set; } = "";
    public string AcceptanceCriteria { get; set; } = "";
    public string AmountWei { get; set; } = "";
    public long DeliveryDeadline { get; set; }
    public long ReviewWindow { get; set; }
    public string ClientReference { get; set; } = "";
    public string TermsJson { get; set; } = "";
    public string TermsHash { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class OrderFile
{
    public Guid Id { get; set; }
    public Guid DraftId { get; set; }
    public Guid UploadedBy { get; set; }
    public string Kind { get; set; } = "";
    public string FileName { get; set; } = "";
    public string Sha256 { get; set; } = "";
    public long Length { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public byte[] Content { get; set; } = [];
}

public sealed class ChainDeployment
{
    public Guid Id { get; set; }
    public long ChainId { get; set; }
    public string ContractAddress { get; set; } = "";
    public long DeploymentBlock { get; set; }
    public string DeploymentBlockHash { get; set; } = "";
    public string TransactionHash { get; set; } = "";
    public long LastBlock { get; set; }
    public string LastBlockHash { get; set; } = "";
    public string Status { get; set; } = "Syncing";
    public DateTimeOffset? CheckedAt { get; set; }
}

public sealed class ChainBlock
{
    public Guid DeploymentId { get; set; }
    public long Number { get; set; }
    public string Hash { get; set; } = "";
}

public sealed class ChainEvent
{
    public Guid DeploymentId { get; set; }
    public string TransactionHash { get; set; } = "";
    public int LogIndex { get; set; }
    public long BlockNumber { get; set; }
    public string BlockHash { get; set; } = "";
    public string Name { get; set; } = "";
    public string? OrderId { get; set; }
    public string Payload { get; set; } = "";
}

public sealed class ChainOrder
{
    public Guid DeploymentId { get; set; }
    public string OrderId { get; set; } = "";
    public string ClientReference { get; set; } = "";
    public string Buyer { get; set; } = "";
    public string Seller { get; set; } = "";
    public string Arbiter { get; set; } = "";
    public string AmountWei { get; set; } = "";
    public string TermsHash { get; set; } = "";
    public long DeliveryDeadline { get; set; }
    public long ReviewWindow { get; set; }
    public long? ReviewDeadline { get; set; }
    public string? DeliveryHash { get; set; }
    public string State { get; set; } = "Created";
    public string BuyerRefundWei { get; set; } = "0";
    public string SellerNetWei { get; set; } = "0";
    public string PlatformFeeWei { get; set; } = "0";
}
