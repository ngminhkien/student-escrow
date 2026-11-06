using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using StudentEscrow.API.Common;
using StudentEscrow.Application.Orders;
using StudentEscrow.Infrastructure.Orders;

namespace StudentEscrow.API.Controllers;

// Its own limits: polling an open chat must not use up the allowance of the order actions.
[Route("api/orders")]
public sealed class OrderChatController(ChatService chat) : AuthenticatedController
{
    [HttpGet("{id:guid}/chat")]
    [EnableRateLimiting("chat-read")]
    public async Task<ActionResult<ChatPage>> Read(Guid id, [FromQuery] long? afterSeq, [FromQuery] long? beforeSeq, CancellationToken ct) =>
        Ok(await chat.ReadAsync(CurrentUserId, id, afterSeq, beforeSeq, ct));

    [HttpPost("{id:guid}/chat")]
    [EnableRateLimiting("chat-send")]
    public async Task<ActionResult<ChatMessageView>> Send(Guid id, SendChatMessageRequest request, CancellationToken ct) =>
        Ok(await chat.SendAsync(CurrentUserId, id, request, ct));

    [HttpPost("{id:guid}/chat/read")]
    [EnableRateLimiting("chat-read")]
    public async Task<IActionResult> MarkRead(Guid id, MarkChatReadRequest request, CancellationToken ct)
    {
        await chat.MarkReadAsync(CurrentUserId, id, request.Seq, ct);
        return NoContent();
    }

    [HttpGet("chat/unread")]
    [EnableRateLimiting("chat-read")]
    public async Task<ActionResult<IReadOnlyList<ChatUnreadView>>> Unread(CancellationToken ct) =>
        Ok(await chat.UnreadAsync(CurrentUserId, ct));
}
