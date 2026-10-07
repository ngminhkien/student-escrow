using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using StudentEscrow.API.Common;
using StudentEscrow.Application.Orders;

namespace StudentEscrow.API.Controllers;

[Route("api/orders")]
[EnableRateLimiting("orders")]
public sealed class OrdersController(IOrderService orders) : AuthenticatedController
{
    [HttpPost]
    public async Task<IActionResult> Create(CreateDraftRequest request, CancellationToken ct)
    {
        var result = await orders.CreateAsync(CurrentUserId, request, ct);
        return CreatedAtAction(nameof(Get), new { id = result.Draft.Id }, result);
    }
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] int skip, CancellationToken ct) => Ok(await orders.ListAsync(CurrentUserId, skip, ct));
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct) => Ok(await orders.GetAsync(CurrentUserId, id, ct));
    [HttpGet("{id:guid}/events")]
    public async Task<IActionResult> Events(Guid id, [FromQuery] int skip, CancellationToken ct) =>
        Ok(await orders.HistoryAsync(CurrentUserId, id, skip, ct));
    [HttpPost("{id:guid}/files")]
    [RequestSizeLimit(51_000_000)]
    [RequestFormLimits(MultipartBodyLengthLimit = 51_000_000)]
    public async Task<IActionResult> Upload(Guid id, [FromForm] UploadOrderFile request, CancellationToken ct)
    {
        await using var stream = request.File.OpenReadStream();
        return Ok(await orders.UploadAsync(CurrentUserId, id, request.Kind, request.File.FileName, stream, ct));
    }
    [HttpGet("{id:guid}/files/{fileId:guid}")]
    public async Task<IActionResult> Download(Guid id, Guid fileId, CancellationToken ct)
    {
        var file = await orders.DownloadAsync(CurrentUserId, id, fileId, ct);
        Response.Headers.XContentTypeOptions = "nosniff";
        Response.Headers.CacheControl = "no-store";
        return File(file.Content, "application/octet-stream", file.FileName);
    }
}

public sealed class UploadOrderFile
{
    [System.ComponentModel.DataAnnotations.Required] public string Kind { get; init; } = "";
    [System.ComponentModel.DataAnnotations.Required] public IFormFile File { get; init; } = null!;
}
