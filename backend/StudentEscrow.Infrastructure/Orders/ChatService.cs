using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using StudentEscrow.Application.Common;
using StudentEscrow.Application.Orders;
using StudentEscrow.Domain.Orders;
using StudentEscrow.Infrastructure.Persistence;

namespace StudentEscrow.Infrastructure.Orders;

// Reads run every few seconds per open order, so they fetch only the columns they use and never touch file content or users.
public sealed class ChatService(StudentEscrowDbContext db, ManifestProvider manifests, BlockchainSettings settings, TimeProvider clock)
{
    private sealed record Room(Guid DeploymentId, string Role, string State, string? ChainOrderId);

    private async Task<string> AddressAsync(Guid userId, CancellationToken ct) =>
        await db.WalletLinks.AsNoTracking().Where(link => link.UserId == userId).Select(link => link.Address).SingleOrDefaultAsync(ct)
        ?? throw new ApplicationError("WALLET_REQUIRED", "Link a wallet before using orders.", 409);

    private async Task<Room> RoomAsync(Guid userId, Guid id, CancellationToken ct)
    {
        var address = await AddressAsync(userId, ct);
        var draft = await db.Set<OrderDraft>().AsNoTracking().Where(item => item.Id == id)
            .Select(item => new { item.DeploymentId, item.Buyer, item.Seller, item.Arbiter, item.ClientReference }).SingleOrDefaultAsync(ct);
        var role = draft is null ? null : address == draft.Buyer ? ChatRules.Buyer : address == draft.Seller ? ChatRules.Seller : address == draft.Arbiter ? ChatRules.Arbiter : null;
        if (draft is null || role is null) throw new ApplicationError("ORDER_NOT_FOUND", "Order or file not found.", 404);
        var chain = await db.Set<ChainOrder>().AsNoTracking()
            .Where(item => item.DeploymentId == draft.DeploymentId && item.Buyer == draft.Buyer && item.ClientReference == draft.ClientReference)
            .Select(item => new { item.State, item.OrderId }).SingleOrDefaultAsync(ct);
        var state = chain?.State ?? ChatRules.NoChainOrder;
        if (!ChatRules.CanRead(role, state))
            throw new ApplicationError("CHAT_NOT_OPEN", "Arbiter chỉ vào trò chuyện khi đơn có tranh chấp.", 403);
        return new Room(draft.DeploymentId, role, state, chain?.OrderId);
    }

    public async Task<ChatPage> ReadAsync(Guid userId, Guid id, long? afterSeq, long? beforeSeq, CancellationToken ct)
    {
        var room = await RoomAsync(userId, id, ct);
        var messages = db.Set<ChatMessage>().AsNoTracking().Where(item => item.DraftId == id);
        // The newest page reads backward from the end. A cursor read goes forward, so nothing is skipped in a long backlog.
        var page = afterSeq is { } after
            ? messages.Where(item => item.Seq > after).OrderBy(item => item.Seq)
            : (beforeSeq is { } before ? messages.Where(item => item.Seq < before) : messages).OrderByDescending(item => item.Seq);
        var rows = await page.Take(ChatRules.PageSize).ToListAsync(ct);
        rows.Sort((left, right) => left.Seq.CompareTo(right.Seq));
        var fileIds = rows.Where(item => item.FileId is not null).Select(item => item.FileId!.Value).Distinct().ToList();
        var files = fileIds.Count == 0 ? [] : await db.Set<OrderFile>().AsNoTracking().Where(item => fileIds.Contains(item.Id))
            .Select(item => new ChatFileView(item.Id, item.FileName, item.Length)).ToListAsync(ct);
        var latest = await messages.OrderByDescending(item => item.Seq).Select(item => item.Seq).FirstOrDefaultAsync(ct);
        return new ChatPage(room.Role, room.State, ChatRules.CanSend(room.Role, room.State), latest,
            rows.ConvertAll(item => ToView(item, userId, files.Find(file => file.Id == item.FileId))), await EventsAsync(room, ct));
    }

    private async Task<IReadOnlyList<ChatEventView>> EventsAsync(Room room, CancellationToken ct)
    {
        if (room.ChainOrderId is null) return [];
        return await db.Set<ChainEvent>().AsNoTracking()
            .Where(item => item.DeploymentId == room.DeploymentId && item.OrderId == room.ChainOrderId)
            .OrderBy(item => item.BlockNumber).ThenBy(item => item.LogIndex)
            .Select(item => new ChatEventView(item.Name, item.BlockNumber, item.LogIndex)).ToListAsync(ct);
    }

    public async Task<ChatMessageView> SendAsync(Guid userId, Guid id, SendChatMessageRequest request, CancellationToken ct)
    {
        var text = request.Text?.Trim() ?? "";
        if (text.Length == 0 && request.FileId is null) throw new ApplicationError("CHAT_EMPTY", "Hãy nhập nội dung tin nhắn.", 400);
        if (text.Length > ChatRules.MaxTextLength) throw new ApplicationError("CHAT_TOO_LONG", $"Tin nhắn không vượt quá {ChatRules.MaxTextLength} ký tự.", 400);
        var room = await RoomAsync(userId, id, ct);
        if (!ChatRules.CanSend(room.Role, room.State) || await ArchivedAsync(room, ct))
            throw new ApplicationError("CHAT_READ_ONLY", "Đơn đã kết thúc nên cuộc trò chuyện chỉ còn để đọc.", 409);
        ChatFileView? file = null;
        if (request.FileId is { } fileId)
        {
            file = await db.Set<OrderFile>().AsNoTracking()
                .Where(item => item.Id == fileId && item.DraftId == id && item.Kind == "evidence" && item.UploadedBy == userId)
                .Select(item => new ChatFileView(item.Id, item.FileName, item.Length)).SingleOrDefaultAsync(ct)
                ?? throw new ApplicationError("CHAT_FILE_INVALID", "Chỉ đính kèm được file bằng chứng bạn đã tải lên đơn này.", 400);
        }
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await SqlLocks.AcquireAsync(db, "chat:" + id, ct);
        var last = await db.Set<ChatMessage>().Where(item => item.DraftId == id).OrderByDescending(item => item.Seq)
            .Select(item => new { item.Seq, item.ChainBlock }).FirstOrDefaultAsync(ct);
        var synced = await db.Set<ChainDeployment>().AsNoTracking().Where(item => item.Id == room.DeploymentId).Select(item => item.LastBlock).SingleAsync(ct);
        var message = new ChatMessage { DraftId = id, Seq = (last?.Seq ?? 0) + 1, SenderUserId = userId, SenderRole = room.Role, Text = text, FileId = file?.Id,
            ChainBlock = Math.Max(last?.ChainBlock ?? 0, synced), CreatedAt = clock.GetUtcNow() };
        db.Add(message);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return ToView(message, userId, file);
    }

    public async Task MarkReadAsync(Guid userId, Guid id, long seq, CancellationToken ct)
    {
        await RoomAsync(userId, id, ct);
        var latest = await db.Set<ChatMessage>().AsNoTracking().Where(item => item.DraftId == id).OrderByDescending(item => item.Seq).Select(item => item.Seq).FirstOrDefaultAsync(ct);
        var target = Math.Min(seq, latest);
        if (target <= 0) return;
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await SqlLocks.AcquireAsync(db, $"chat-read:{id}:{userId}", ct);
        var state = await db.Set<ChatReadState>().SingleOrDefaultAsync(item => item.DraftId == id && item.UserId == userId, ct);
        if (state is null) db.Add(new ChatReadState { DraftId = id, UserId = userId, LastReadSeq = target });
        else if (state.LastReadSeq < target) state.LastReadSeq = target;
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
    }

    public async Task<IReadOnlyList<ChatUnreadView>> UnreadAsync(Guid userId, CancellationToken ct)
    {
        var address = await AddressAsync(userId, ct);
        var reads = db.Set<ChatReadState>().AsNoTracking().Where(item => item.UserId == userId);
        return await (from message in db.Set<ChatMessage>().AsNoTracking()
                      join draft in db.Set<OrderDraft>().AsNoTracking() on message.DraftId equals draft.Id
                      where message.SenderUserId != userId
                          && (draft.Buyer == address || draft.Seller == address
                              || (draft.Arbiter == address && db.Set<ChainOrder>().Any(order => order.DeploymentId == draft.DeploymentId
                                  && order.Buyer == draft.Buyer && order.ClientReference == draft.ClientReference && order.State == "Disputed")))
                          && message.Seq > (reads.Where(item => item.DraftId == draft.Id).Select(item => (long?)item.LastReadSeq).FirstOrDefault() ?? 0)
                      group message by message.DraftId into items
                      select new ChatUnreadView(items.Key, items.Count())).ToListAsync(ct);
    }

    // An order from an earlier chain stays readable, but nothing can happen on it any more.
    private async Task<bool> ArchivedAsync(Room room, CancellationToken ct)
    {
        if (!settings.Enabled) return false;
        try { return (await manifests.ReadAsync(ct)).DeploymentId != room.DeploymentId; }
        catch (Exception exception) when (exception is IOException or InvalidDataException or InvalidOperationException or JsonException) { return false; }
    }

    private static ChatMessageView ToView(ChatMessage item, Guid userId, ChatFileView? file) =>
        new(item.Seq, item.SenderRole, item.SenderUserId == userId, item.Text, file, item.ChainBlock, item.CreatedAt);
}
