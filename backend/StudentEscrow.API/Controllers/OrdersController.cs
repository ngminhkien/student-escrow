using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using StudentEscrow.API.Common;
using StudentEscrow.Application.Orders;
using StudentEscrow.Infrastructure.Orders;

namespace StudentEscrow.API.Controllers;

[Route("api/orders")]
[EnableRateLimiting("orders")]
public sealed class OrdersController(IOrderService orders, CustodialChainService custody) : AuthenticatedController
{
    [HttpPost]
    public async Task<IActionResult> Create(CreateDraftRequest request, CancellationToken ct)
    {
        var result = await orders.CreateAsync(CurrentUserId, request, ct);
        return CreatedAtAction(nameof(Get), new { id = result.Draft.Id }, result);
    }
    [HttpGet("terms")]
    public ActionResult<StandardTermsResponse> Terms([FromQuery] string? version)
    {
        var document = version is null ? StandardTerms.Current : StandardTerms.Find(version);
        if (document is null) return NotFound();
        return Ok(new StandardTermsResponse(document.Version, document.Title, document.Text, document.Hash));
    }
    [HttpGet("arbiters")]
    public async Task<ActionResult<IReadOnlyList<ArbiterResponse>>> Arbiters(CancellationToken ct) => Ok(await orders.ArbitersAsync(ct));
    // POST keeps the email out of URLs and access logs. Exact match only, behind login and the rate limit.
    [HttpPost("party-lookup")]
    public async Task<ActionResult<PartyLookupResponse>> FindParty(PartyLookupRequest request, CancellationToken ct) =>
        Ok(await orders.FindPartyAsync(CurrentUserId, request.Email, ct));
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] int skip, CancellationToken ct) => Ok(await orders.ListAsync(CurrentUserId, skip, ct));
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct) => Ok(await orders.GetAsync(CurrentUserId, id, ct));
    [HttpGet("{id:guid}/events")]
    public async Task<IActionResult> Events(Guid id, [FromQuery] int skip, CancellationToken ct) =>
        Ok(await orders.HistoryAsync(CurrentUserId, id, skip, ct));
    [HttpPost("{id:guid}/actions")]
    public async Task<ActionResult<ChainActionResponse>> Action(Guid id, OrderActionRequest request, CancellationToken ct) =>
        Ok(await custody.ExecuteAsync(CurrentUserId, id, request, ct));
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
