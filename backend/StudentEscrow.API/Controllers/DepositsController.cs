using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using StudentEscrow.API.Common;
using StudentEscrow.Application.Wallets;
using StudentEscrow.Infrastructure.Payments;

namespace StudentEscrow.API.Controllers;

[Route("api/wallets/deposits")]
[EnableRateLimiting("wallet-kyc")]
public sealed class DepositsController(DepositService deposits) : AuthenticatedController
{
    [HttpPost]
    public async Task<ActionResult<DepositResponse>> Create(CreateDepositRequest request, CancellationToken ct) =>
        Ok(await deposits.CreateAsync(CurrentUserId, request, ct));

    // Reads run after every action and on a timer, so they cannot share the strict limit meant for writes.
    [EnableRateLimiting("orders")]
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<DepositResponse>>> List(CancellationToken ct) =>
        Ok(await deposits.ListAsync(CurrentUserId, ct));

    [EnableRateLimiting("orders")]
    [HttpGet("{id:guid}")]
    public async Task<ActionResult<DepositResponse>> Get(Guid id, CancellationToken ct) =>
        Ok(await deposits.GetAsync(CurrentUserId, id, ct));

    [HttpPost("{id:guid}/cancel")]
    public async Task<ActionResult<DepositResponse>> Cancel(Guid id, CancellationToken ct) =>
        Ok(await deposits.CancelAsync(CurrentUserId, id, ct));

    // Paid, but the ETH could not be sent yet. Does nothing unless a send is known not to have happened.
    [HttpPost("{id:guid}/payout")]
    public async Task<ActionResult<DepositResponse>> RetryPayout(Guid id, CancellationToken ct) =>
        Ok(await deposits.RetryPayoutAsync(CurrentUserId, id, ct));

    // The simulated gateway's "pay" screen. Absent when Payments:MockEnabled is off.
    [HttpPost("{id:guid}/mock-payment")]
    public async Task<ActionResult<DepositResponse>> MockPayment(Guid id, MockPaymentRequest request, CancellationToken ct) =>
        Ok(await deposits.PayWithMockAsync(CurrentUserId, id, request.Outcome, ct));
}

// Called by the gateway, which has no user session: the signature is the authentication.
[ApiController]
[Route("api/payments")]
public sealed class PaymentWebhookController(DepositService deposits) : ControllerBase
{
    [HttpPost("webhook")]
    [EnableRateLimiting("payment-webhook")]
    public async Task<ActionResult<PaymentWebhookResponse>> Webhook(PaymentWebhookRequest request, CancellationToken ct) =>
        Ok(await deposits.ApplyWebhookAsync(request, ct));
}
