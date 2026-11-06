namespace StudentEscrow.Domain.Orders;

// Evidence for a dispute, so the application never updates or deletes a row.
public sealed class ChatMessage
{
    public Guid DraftId { get; set; }
    // Gapless per order. Readers use it as their cursor, so it is assigned under a per-order lock.
    public long Seq { get; set; }
    public Guid SenderUserId { get; set; }
    public string SenderRole { get; set; } = "";
    public string Text { get; set; } = "";
    public Guid? FileId { get; set; }
    // The last synced block when this was sent. It places the message among chain events, because a local chain's clock
    // can run ahead of the wall clock and timestamps would put them in the wrong order. Never decreases within an order.
    public long ChainBlock { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class ChatReadState
{
    public Guid DraftId { get; set; }
    public Guid UserId { get; set; }
    public long LastReadSeq { get; set; }
}
