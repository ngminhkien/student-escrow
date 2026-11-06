namespace StudentEscrow.Application.Orders;

public sealed class SendChatMessageRequest
{
    public string? Text { get; init; }
    public Guid? FileId { get; init; }
}

public sealed class MarkChatReadRequest
{
    public long Seq { get; init; }
}

public sealed record ChatFileView(Guid Id, string FileName, long Length);
public sealed record ChatMessageView(long Seq, string SenderRole, bool Mine, string Text, ChatFileView? File, long ChainBlock, DateTimeOffset CreatedAt);
// Taken from the verified chain journal on every read, so a person cannot post one.
public sealed record ChatEventView(string Name, long BlockNumber, int LogIndex);
public sealed record ChatPage(string Role, string State, bool CanSend, long LatestSeq, IReadOnlyList<ChatMessageView> Messages, IReadOnlyList<ChatEventView> Events);
public sealed record ChatUnreadView(Guid DraftId, int Count);

public static class ChatRules
{
    public const string Buyer = "Buyer";
    public const string Seller = "Seller";
    public const string Arbiter = "Arbiter";
    public const int MaxTextLength = 2000;
    public const int PageSize = 100;
    // An order with no chain record yet is still a deal being set up, and the parties can talk.
    public const string NoChainOrder = "Draft";

    private static readonly string[] Finished = ["Completed", "Resolved", "Refunded", "Cancelled"];

    // The Arbiter stays out of the parties' conversation until it is called in.
    public static bool CanRead(string role, string state) => role != Arbiter || state is "Disputed" or "Resolved";

    public static bool CanSend(string role, string state) =>
        role == Arbiter ? state == "Disputed" : !Finished.Contains(state);
}
