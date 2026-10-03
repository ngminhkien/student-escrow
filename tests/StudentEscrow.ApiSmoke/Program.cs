using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Nethereum.Signer;

var baseUrl = args.Length == 0 ? "http://localhost:5180" : args[0];
if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var endpoint) || !endpoint.IsLoopback
    || endpoint.Scheme is not ("http" or "https") || endpoint.AbsolutePath != "/"
    || !string.IsNullOrEmpty(endpoint.UserInfo) || !string.IsNullOrEmpty(endpoint.Query))
{
    Console.Error.WriteLine("FAIL: This script is restricted to a loopback demo API.");
    return 1;
}

using var client = new HttpClient { BaseAddress = endpoint, Timeout = TimeSpan.FromSeconds(30) };
var jsonOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web);

async Task<JsonElement> Send(string method, string path, int expected, object? body = null, string? token = null)
{
    using var request = new HttpRequestMessage(new HttpMethod(method), path);
    if (body is not null) request.Content = JsonContent.Create(body);
    if (token is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
    using var response = await client.SendAsync(request);
    if ((int)response.StatusCode != expected)
    {
        throw new InvalidOperationException($"{method} {path}: expected {expected}, received {(int)response.StatusCode}. Check API logs.");
    }

    Console.WriteLine($"PASS {method} {path} ({expected})");
    return await response.Content.ReadFromJsonAsync<JsonElement>(jsonOptions);
}

static void Require(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
    Console.WriteLine("PASS " + message);
}

async Task<(string Token, string Email)> Account()
{
    var email = $"wallet.smoke.{Guid.NewGuid():N}@example.test";
    var result = await Send("POST", "/api/auth/register", 201,
        new { email, fullName = "Demo Wallet Student", password = "DemoPassword123!" });
    return (result.GetProperty("accessToken").GetString()!, email);
}

async Task<JsonElement> Challenge(string token, EthECKey key) => await Send("POST", "/api/wallets/challenges", 200,
    new { address = key.GetPublicAddress(), chainId = 31337 }, token);

static object Proof(JsonElement challenge, EthECKey key, bool tampered = false) => new
{
    challengeId = challenge.GetProperty("challengeId").GetGuid(),
    signature = new EthereumMessageSigner().EncodeUTF8AndSign(challenge.GetProperty("message").GetString()! + (tampered ? "tampered" : ""), key)
};

static object Kyc(bool pass = true) => new
{
    fullName = "Demo Wallet Student", studentNumber = "DEMO-123456",
    documentReference = "DEMO-DOCUMENT-PASS", selfieReference = pass ? "DEMO-SELFIE-PASS" : "DEMO-SELFIE-FAIL"
};

try
{
    await Send("GET", "/api/health/live", 200);
    await Send("GET", "/api/health/ready", 200);
    var swagger = await Send("GET", "/swagger/v1/swagger.json", 200);
    Require(swagger.GetProperty("paths").TryGetProperty("/api/wallets/link", out _), "Swagger includes wallet linking");
    Require(swagger.GetProperty("paths").TryGetProperty("/api/kyc/submissions", out _), "Swagger includes mock KYC");
    await Send("GET", "/api/wallets/me", 401);
    await Send("GET", "/api/kyc/me", 401);
    await Send("POST", "/api/wallets/challenges", 401, new { address = "0x0000000000000000000000000000000000000001", chainId = 31337 });
    await Send("POST", "/api/wallets/link", 401, new { challengeId = Guid.NewGuid(), signature = "0x" + new string('0', 130) });
    await Send("POST", "/api/kyc/submissions", 401, Kyc());

    var buyer = await Account();
    var other = await Account();
    var buyerKey = EthECKey.GenerateKey();
    var otherKey = EthECKey.GenerateKey();
    Require(!(await Send("GET", "/api/wallets/me", 200, token: buyer.Token)).GetProperty("linked").GetBoolean(), "New account is not wallet linked");
    Require((await Send("GET", "/api/kyc/me", 200, token: buyer.Token)).GetProperty("status").GetString() == "NOT_SUBMITTED", "New account is not KYC verified");
    var walletRequired = await Send("POST", "/api/kyc/submissions", 409, Kyc(), buyer.Token);
    Require(walletRequired.GetProperty("code").GetString() == "WALLET_REQUIRED", "KYC requires a linked wallet");
    await Send("POST", "/api/wallets/challenges", 400, new { address = "not-a-wallet", chainId = 31337 }, buyer.Token);
    await Send("POST", "/api/wallets/challenges", 400, new { address = buyerKey.GetPublicAddress(), chainId = 1 }, buyer.Token);
    await Send("POST", "/api/wallets/link", 400, new { challengeId = Guid.NewGuid(), signature = "bad" }, buyer.Token);

    var challenge = await Challenge(buyer.Token, buyerKey);
    var competingChallenge = await Challenge(other.Token, buyerKey);
    await Send("POST", "/api/wallets/link", 404, Proof(challenge, buyerKey), other.Token);
    await Send("POST", "/api/wallets/link", 400, Proof(challenge, otherKey), buyer.Token);
    await Send("POST", "/api/wallets/link", 400, Proof(challenge, buyerKey, tampered: true), buyer.Token);
    var proof = Proof(challenge, buyerKey);
    var linked = await Send("POST", "/api/wallets/link", 200, proof, buyer.Token);
    Require(linked.GetProperty("linked").GetBoolean(), "Correct signature links wallet");
    await Send("POST", "/api/wallets/link", 409, proof, buyer.Token);
    await Send("POST", "/api/wallets/link", 409, Proof(competingChallenge, buyerKey), other.Token);
    var persisted = await Send("GET", "/api/wallets/me", 200, token: buyer.Token);
    Require(string.Equals(persisted.GetProperty("address").GetString(), buyerKey.GetPublicAddress(), StringComparison.OrdinalIgnoreCase), "Wallet persisted under correct account");
    await Send("POST", "/api/wallets/challenges", 409, new { address = otherKey.GetPublicAddress(), chainId = 31337 }, buyer.Token);
    await Send("POST", "/api/kyc/submissions", 400,
        new { fullName = "Demo", studentNumber = "DEMO-123456", documentReference = "uploaded-file.png", selfieReference = "DEMO-SELFIE-PASS" }, buyer.Token);

    var verified = await Send("POST", "/api/kyc/submissions", 200, Kyc(), buyer.Token);
    Require(verified.GetProperty("status").GetString() == "VERIFIED", "PASS fixture is mock VERIFIED");
    Require(verified.GetProperty("isMock").GetBoolean() && !verified.GetProperty("canCreateEscrow").GetBoolean()
        && verified.GetProperty("onChainVerificationStatus").GetString() == "NOT_IMPLEMENTED", "Mock KYC does not grant on-chain or escrow verification");
    await Send("POST", "/api/kyc/submissions", 409, Kyc(false), buyer.Token);
    Require((await Send("GET", "/api/kyc/me", 200, token: buyer.Token)).GetProperty("status").GetString() == "VERIFIED", "Verified KYC persisted");
    Require((await Send("GET", "/api/kyc/me", 200, token: other.Token)).GetProperty("status").GetString() == "NOT_SUBMITTED", "Another account cannot inherit KYC");

    var ownChallenge = await Challenge(other.Token, otherKey);
    var ownProof = Proof(ownChallenge, otherKey);
    async Task<int> RaceLink()
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/wallets/link") { Content = JsonContent.Create(ownProof) };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", other.Token);
        using var response = await client.SendAsync(request);
        return (int)response.StatusCode;
    }

    var raceResults = await Task.WhenAll(RaceLink(), RaceLink());
    Require(raceResults.Order().SequenceEqual(new[] { 200, 409 }), "Concurrent wallet proof: exactly one success and one conflict");
    var rejected = await Send("POST", "/api/kyc/submissions", 200, Kyc(false), other.Token);
    Require(rejected.GetProperty("status").GetString() == "REJECTED" && rejected.GetProperty("reasonCode").GetString() == "MOCK_SELFIE_FAILED", "FAIL fixture is mock REJECTED");
    async Task<int> RaceKyc()
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/kyc/submissions") { Content = JsonContent.Create(Kyc()) };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", other.Token);
        using var response = await client.SendAsync(request);
        return (int)response.StatusCode;
    }

    Require((await Task.WhenAll(RaceKyc(), RaceKyc())).Order().SequenceEqual(new[] { 200, 409 }), "Concurrent KYC resubmission: exactly one success and one conflict");
    Require((await Send("GET", "/api/kyc/me", 200, token: other.Token)).GetProperty("status").GetString() == "VERIFIED", "Rejected KYC can be resubmitted and persisted");
    Console.WriteLine("Wallet/KYC API smoke checks passed. This is a SQL/API check, not an on-chain test.");
    Console.WriteLine($"Demo accounts persisted: {buyer.Email}; {other.Email}. Random wallet private keys were used only in memory and discarded; never send funds to these addresses.");
    return 0;
}
catch (Exception exception)
{
    Console.Error.WriteLine("FAIL: " + exception.Message);
    return 1;
}
