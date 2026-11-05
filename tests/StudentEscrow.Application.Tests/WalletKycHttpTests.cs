using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Nethereum.Signer;
using StudentEscrow.Application.Auth;
using StudentEscrow.Application.Kyc;
using StudentEscrow.Application.Wallets;
using Xunit;

using StudentEscrow.Infrastructure.Payments;

namespace StudentEscrow.Application.Tests;

public sealed class WalletKycHttpTests
{
    [Fact]
    public async Task SwaggerJwtValidationWalletProofAndKycWorkThroughRealHttpPipelineWithTestRepositories()
    {
        await using var factory = new TestApiFactory();
        using var client = factory.CreateClient();
        using var swaggerResponse = await client.GetAsync("/swagger/v1/swagger.json");
        Assert.Equal(HttpStatusCode.OK, swaggerResponse.StatusCode);
        var swagger = await swaggerResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(swagger.GetProperty("paths").TryGetProperty("/api/wallets/link", out _));
        Assert.True(swagger.GetProperty("paths").TryGetProperty("/api/kyc/submissions", out _));
        using var anonymous = await client.GetAsync("/api/kyc/me");
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        var buyer = await Register(client, "buyer@example.test");
        var other = await Register(client, "other@example.test");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", buyer);
        using var noWallet = await client.PostAsJsonAsync("/api/kyc/submissions", Kyc());
        Assert.Equal(HttpStatusCode.Conflict, noWallet.StatusCode);
        using var invalid = await client.PostAsJsonAsync("/api/wallets/link", new { challengeId = Guid.NewGuid(), signature = "invalid" });
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        var key = EthECKey.GenerateKey();
        using var challengeResponse = await client.PostAsJsonAsync("/api/wallets/challenges", new { address = key.GetPublicAddress(), chainId = 31337 });
        Assert.Equal(HttpStatusCode.OK, challengeResponse.StatusCode);
        var challenge = (await challengeResponse.Content.ReadFromJsonAsync<WalletChallengeResponse>())!;
        var proof = new { challengeId = challenge.ChallengeId, signature = new EthereumMessageSigner().EncodeUTF8AndSign(challenge.Message, key) };
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", other);
        using var stolen = await client.PostAsJsonAsync("/api/wallets/link", proof);
        Assert.Equal(HttpStatusCode.NotFound, stolen.StatusCode);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", buyer);
        using var linked = await client.PostAsJsonAsync("/api/wallets/link", proof);
        Assert.Equal(HttpStatusCode.OK, linked.StatusCode);
        using var replay = await client.PostAsJsonAsync("/api/wallets/link", proof);
        Assert.Equal(HttpStatusCode.Conflict, replay.StatusCode);
        using var rejectedResponse = await client.PostAsJsonAsync("/api/kyc/submissions", Kyc(pass: false));
        Assert.Equal(HttpStatusCode.OK, rejectedResponse.StatusCode);
        Assert.Equal("REJECTED", (await rejectedResponse.Content.ReadFromJsonAsync<KycResponse>())!.Status);
        using var verifiedResponse = await client.PostAsJsonAsync("/api/kyc/submissions", Kyc());
        Assert.Equal(HttpStatusCode.OK, verifiedResponse.StatusCode);
        var verified = (await verifiedResponse.Content.ReadFromJsonAsync<KycResponse>())!;
        Assert.Equal("VERIFIED", verified.Status);
        Assert.True(verified.IsMock);
        Assert.False(verified.CanCreateEscrow);
        Assert.Equal("NOT_IMPLEMENTED", verified.OnChainVerificationStatus);
        using var downgrade = await client.PostAsJsonAsync("/api/kyc/submissions", Kyc(pass: false));
        Assert.Equal(HttpStatusCode.Conflict, downgrade.StatusCode);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", other);
        var otherKyc = await client.GetFromJsonAsync<KycResponse>("/api/kyc/me");
        Assert.Equal("NOT_SUBMITTED", otherKyc!.Status);
        var otherWallet = await client.GetFromJsonAsync<WalletResponse>("/api/wallets/me");
        Assert.False(otherWallet!.Linked);
    }

    private static object Kyc(bool pass = true) => new
    {
        fullName = "Demo Student", studentNumber = "DEMO-123456",
        documentReference = "DEMO-DOCUMENT-PASS", selfieReference = pass ? "DEMO-SELFIE-PASS" : "DEMO-SELFIE-FAIL"
    };

    private static async Task<string> Register(HttpClient client, string email)
    {
        using var response = await client.PostAsJsonAsync("/api/auth/register", new { email, fullName = "Demo Student", password = "DemoPassword123!" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<AuthResponse>())!.AccessToken;
    }

    [Fact]
    public async Task RefreshingTheAccountPageDoesNotUseUpTheWriteLimit()
    {
        await using var factory = new TestApiFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", await Register(client, "reader@example.test"));
        // More reads than the 30 per minute that wallet and KYC writes are allowed.
        for (var index = 0; index < 40; index++)
        {
            using var read = await client.GetAsync("/api/kyc/me");
            Assert.NotEqual(HttpStatusCode.TooManyRequests, read.StatusCode);
        }
        using var write = await client.PostAsJsonAsync("/api/wallets/link", new { challengeId = Guid.NewGuid(), signature = "invalid" });
        Assert.NotEqual(HttpStatusCode.TooManyRequests, write.StatusCode);
    }

    [Fact]
    public async Task DepositEndpointsNeedASessionAndTheWebhookNeedsAValidSignature()
    {
        await using var factory = new TestApiFactory();
        using var client = factory.CreateClient();
        var id = Guid.NewGuid();
        using var list = await client.GetAsync("/api/wallets/deposits");
        Assert.Equal(HttpStatusCode.Unauthorized, list.StatusCode);
        using var pay = await client.PostAsJsonAsync($"/api/wallets/deposits/{id}/mock-payment", new { outcome = "Succeeded" });
        Assert.Equal(HttpStatusCode.Unauthorized, pay.StatusCode);

        var body = new { depositId = id, amountVnd = 100000, status = "Succeeded", gatewayTransactionId = "TX-1", timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds(), signature = new string('0', 64) };
        using var forged = await client.PostAsJsonAsync("/api/payments/webhook", body);
        Assert.Equal(HttpStatusCode.Unauthorized, forged.StatusCode);
        Assert.Equal("INVALID_PAYMENT_SIGNATURE", (await forged.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
        using var malformed = await client.PostAsJsonAsync("/api/payments/webhook", new { depositId = id, amountVnd = 100000, status = "Paid", gatewayTransactionId = "TX|1", timestamp = 1, signature = "x" });
        Assert.Equal(HttpStatusCode.BadRequest, malformed.StatusCode);
    }

    private sealed class TestApiFactory : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Development");
            builder.ConfigureAppConfiguration((context, configuration) => configuration.AddInMemoryCollection(
                new Dictionary<string, string?> { ["Database:ApplyMigrationsOnStartup"] = "false" }));
            builder.ConfigureServices(services =>
            {
                var repository = new WalletKycTests.MemoryRepositories();
                services.RemoveAll<IUserRepository>();
                services.RemoveAll<IWalletRepository>();
                services.RemoveAll<IKycRepository>();
                services.AddSingleton<IUserRepository>(repository);
                services.AddSingleton<IWalletRepository>(repository);
                services.AddSingleton<IKycRepository>(repository);
                // These tests link self-held wallets and run without SQL or a master key.
                services.RemoveAll<IWalletProvisioner>();
                services.AddSingleton<IWalletProvisioner, DisabledWalletProvisioner>();
                // Keeps these tests away from the developer's .runtime/payment-webhook.key.
                services.RemoveAll<PaymentSigner>();
                services.AddSingleton(new PaymentSigner(new byte[32]));
            });
        }
    }
}
