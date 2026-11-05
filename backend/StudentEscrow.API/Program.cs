using System.Security.Cryptography;
using System.Text;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.DataProtection.KeyManagement;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi;
using StudentEscrow.API.Common;
using StudentEscrow.Application.Auth;
using StudentEscrow.Application.Wallets;
using StudentEscrow.Application.Kyc;
using StudentEscrow.Infrastructure.Wallets;
using StudentEscrow.Infrastructure.Auth;
using StudentEscrow.Infrastructure.Persistence;
using StudentEscrow.Application.Orders;
using StudentEscrow.Infrastructure.Orders;
using StudentEscrow.Infrastructure.Ledger;
using StudentEscrow.Infrastructure.Payments;
using StudentEscrow.Application.Risk;
using StudentEscrow.Infrastructure.Risk;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
if (builder.Environment.IsDevelopment())
{
    builder.Services.AddDataProtection().UseEphemeralDataProtectionProvider();
    builder.Services.Configure<KeyManagementOptions>(options =>
        options.XmlRepository = new DevelopmentKeyRepository());
}
builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: false);
builder.Configuration.AddEnvironmentVariables();
var connectionString = builder.Configuration.GetConnectionString("StudentEscrow")
    ?? throw new InvalidOperationException("Configure ConnectionStrings__StudentEscrow before starting the API.");
var jwt = builder.Configuration.GetSection("Jwt").Get<JwtSettings>() ?? new JwtSettings();
var ephemeralKey = string.IsNullOrWhiteSpace(jwt.SigningKey);
if (ephemeralKey && builder.Environment.IsDevelopment())
{
    jwt.SigningKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(64));
}

if (Encoding.UTF8.GetByteCount(jwt.SigningKey) < 32 || jwt.ExpirationMinutes is < 5 or > 120
    || string.IsNullOrWhiteSpace(jwt.Issuer) || string.IsNullOrWhiteSpace(jwt.Audience))
{
    throw new InvalidOperationException("Jwt configuration requires a signing key of at least 32 bytes, issuer, audience and 5-120 expiration minutes.");
}

builder.Services.AddSingleton(jwt);
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<IPasswordService, PasswordService>();
builder.Services.AddScoped<ITokenService, TokenService>();
builder.Services.AddScoped<IUserRepository, UserRepository>();
builder.Services.AddScoped<IAuthService, AuthService>();
var walletSettings = builder.Configuration.GetSection("Wallet").Get<WalletSettings>() ?? new WalletSettings();
if (!Uri.TryCreate(walletSettings.Uri, UriKind.Absolute, out var walletUri)
    || walletUri.Authority != walletSettings.Domain || walletSettings.Domain.Contains('\n')
    || walletSettings.Domain.Contains('\r') || !string.IsNullOrEmpty(walletUri.UserInfo)
    || walletUri.Scheme is not ("http" or "https")
    || (!builder.Environment.IsDevelopment() && walletUri.Scheme != "https")
    || walletSettings.ChallengeLifetimeMinutes is < 1 or > 10
    || walletSettings.AllowedChainIds.Length == 0
    || walletSettings.AllowedChainIds.Any(chainId => chainId is not (31337 or 11155111)))
{
    throw new InvalidOperationException("Invalid wallet domain, URI, chain IDs or challenge lifetime configuration.");
}
var kycSettings = builder.Configuration.GetSection("Kyc").Get<KycSettings>() ?? new KycSettings();
if (kycSettings.EnableMockVerification && !builder.Environment.IsDevelopment())
{
    throw new InvalidOperationException("Mock KYC is allowed only in Development.");
}
builder.Services.AddSingleton(walletSettings);
builder.Services.AddSingleton(kycSettings);
builder.Services.AddSingleton<IWalletSignatureVerifier, EthereumSignatureVerifier>();
builder.Services.AddScoped<IWalletRepository, WalletRepository>();
builder.Services.AddScoped<IWalletService, WalletService>();
builder.Services.AddScoped<IKycRepository, KycRepository>();
builder.Services.AddScoped<IKycService, KycService>();
builder.Services.AddDbContext<StudentEscrowDbContext>(options => options.UseSqlServer(connectionString));
var blockchain = builder.Configuration.GetSection("Blockchain").Get<BlockchainSettings>() ?? new BlockchainSettings();
if (blockchain.PollSeconds is < 1 or > 60 || blockchain.BatchSize is < 1 or > 100
    || blockchain.Confirmations is < 0 or > 100
    || !Uri.TryCreate(blockchain.RpcUrl, UriKind.Absolute, out var rpcUri) || rpcUri.Scheme is not ("http" or "https")
    || (blockchain.Enabled && (!builder.Environment.IsDevelopment() || !rpcUri.IsLoopback)))
    throw new InvalidOperationException("Part 04 supports Development and loopback RPC only; check Blockchain settings.");
blockchain.ManifestPath = Path.GetFullPath(blockchain.ManifestPath, builder.Environment.ContentRootPath);
builder.Services.AddSingleton(blockchain);
builder.Services.AddSingleton<ManifestProvider>();
builder.Services.AddSingleton<IBlockchainSource, NethereumSource>();
builder.Services.AddScoped<BlockchainSync>();
builder.Services.AddHostedService<BlockchainWorker>();
builder.Services.AddScoped<IOrderService, OrderService>();
builder.Services.AddScoped<LedgerService>();
builder.Services.AddScoped<CustodialChainService>();
builder.Services.AddSingleton<IChainGateway, NethereumChainGateway>();
var custodial = builder.Configuration.GetSection("CustodialWallet").Get<CustodialSettings>() ?? new CustodialSettings();
// Treasury and imported keys come from Hardhat's public mnemonic, so custody must stay on the local chain.
if (custodial.Enabled && (!builder.Environment.IsDevelopment() || !blockchain.Enabled))
    throw new InvalidOperationException("Custodial wallets require Development and the local blockchain worker.");
custodial.MasterKeyFile = Path.GetFullPath(custodial.MasterKeyFile, builder.Environment.ContentRootPath);
builder.Services.AddSingleton(custodial);
if (custodial.Enabled)
{
    builder.Services.AddSingleton(_ => WalletKeyVault.Load(custodial, builder.Environment.IsDevelopment()));
    builder.Services.AddScoped<CustodialWalletProvisioner>();
    builder.Services.AddScoped<IWalletProvisioner>(services => services.GetRequiredService<CustodialWalletProvisioner>());
}
else
{
    builder.Services.AddSingleton<IWalletProvisioner, DisabledWalletProvisioner>();
}
var payments = builder.Configuration.GetSection("Payments").Get<PaymentSettings>() ?? new PaymentSettings();
// The mock gateway credits balances without any money arriving, so it must never reach a real deployment.
if (payments.MockEnabled && !builder.Environment.IsDevelopment())
    throw new InvalidOperationException("The mock payment gateway is allowed only in Development.");
payments.WebhookSecretFile = Path.GetFullPath(payments.WebhookSecretFile, builder.Environment.ContentRootPath);
builder.Services.AddSingleton(payments);
// While payments are off nothing is signed or accepted, so no secret needs to exist: a random one verifies nothing.
builder.Services.AddSingleton(_ => payments.MockEnabled
    ? PaymentSigner.Load(payments, builder.Environment.IsDevelopment())
    : new PaymentSigner(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32)));
builder.Services.AddScoped<DepositService>();
var risk = builder.Configuration.GetSection("Risk").Get<RiskSettings>() ?? new RiskSettings();
risk.ModelDirectory = Path.GetFullPath(risk.ModelDirectory, builder.Environment.ContentRootPath);
risk.SyntheticDataPath = Path.GetFullPath(risk.SyntheticDataPath, builder.Environment.ContentRootPath);
builder.Services.AddSingleton(risk);
builder.Services.AddSingleton<IRiskModel>(services => new MlRiskModel(risk.ModelDirectory, services.GetRequiredService<ILogger<MlRiskModel>>()));
builder.Services.AddScoped<RiskService>();
builder.Services.AddScoped<AnalyticsService>();
builder.Services.AddExceptionHandler<ExceptionHandler>();
builder.Services.AddProblemDetails();
builder.Services.AddControllers().ConfigureApiBehaviorOptions(options =>
{
    options.InvalidModelStateResponseFactory = context => new BadRequestObjectResult(
        new ApiError("VALIDATION_ERROR", "Dữ liệu không hợp lệ. Kiểm tra các trường bắt buộc và định dạng.", context.HttpContext.TraceIdentifier));
});
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(options =>
{
    options.MapInboundClaims = false;
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        ValidIssuer = jwt.Issuer,
        ValidAudience = jwt.Audience,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.SigningKey)),
        ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
        ClockSkew = TimeSpan.FromSeconds(30)
    };
    options.Events = new JwtBearerEvents
    {
        OnChallenge = async context =>
        {
            context.HandleResponse();
            context.Response.StatusCode = 401;
            context.Response.Headers.WWWAuthenticate = "Bearer";
            await context.Response.WriteAsJsonAsync(new ApiError("UNAUTHORIZED", "Cần token đăng nhập hợp lệ.", context.HttpContext.TraceIdentifier));
        },
        OnForbidden = async context =>
        {
            context.Response.StatusCode = 403;
            await context.Response.WriteAsJsonAsync(new ApiError("FORBIDDEN", "Bạn không có quyền truy cập.", context.HttpContext.TraceIdentifier));
        }
    };
});
builder.Services.AddAuthorization();
builder.Services.AddRateLimiter(options =>
{
    options.AddPolicy("orders", context => RateLimitPartition.GetFixedWindowLimiter(
        context.User.FindFirst("sub")?.Value ?? context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 240, Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0, AutoReplenishment = true }));
    options.AddPolicy("auth", context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 20,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
            AutoReplenishment = true
        }));
    options.AddPolicy("wallet-kyc", context => RateLimitPartition.GetFixedWindowLimiter(
        context.User.FindFirst("sub")?.Value ?? context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 30,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
            AutoReplenishment = true
        }));
    options.AddPolicy("payment-webhook", context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 120, Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0, AutoReplenishment = true }));
    options.OnRejected = async (context, cancellationToken) =>
    {
        context.HttpContext.Response.StatusCode = 429;
        await context.HttpContext.Response.WriteAsJsonAsync(
            new ApiError("RATE_LIMITED", "Quá nhiều yêu cầu. Thử lại sau một phút.", context.HttpContext.TraceIdentifier), cancellationToken);
    };
});
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "StudentEscrow API",
        Version = "v1",
        Description = "Phần 4: tài khoản/ví/KYC mock, bản nháp đơn, file/SHA-256 và worker đồng bộ contract local vào SQL. Client ký giao dịch; API không giữ private key. KYC mock không tự xác minh ví on-chain."
    });
    options.AddSecurityDefinition("bearer", new OpenApiSecurityScheme
    {
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        Description = "Dán accessToken từ register/login, không thêm tiền tố Bearer."
    });
    options.AddSecurityRequirement(document => new OpenApiSecurityRequirement
    {
        [new OpenApiSecuritySchemeReference("bearer", document)] = []
    });
});

var app = builder.Build();
if (ephemeralKey && app.Environment.IsDevelopment())
{
    app.Logger.LogWarning("Development uses an ephemeral JWT key. Sign in again after restarting the API, or configure Jwt__SigningKey locally.");
}

if (app.Configuration.GetValue<bool>("Database:ApplyMigrationsOnStartup"))
{
    if (!app.Environment.IsDevelopment())
    {
        throw new InvalidOperationException("Startup migrations are only allowed in Development. Apply production migrations separately.");
    }

    await using var scope = app.Services.CreateAsyncScope();
    try
    {
        await scope.ServiceProvider.GetRequiredService<StudentEscrowDbContext>().Database.MigrateAsync();
        if (custodial is { Enabled: true, ImportHardhatWallets: true })
        {
            var imported = await scope.ServiceProvider.GetRequiredService<CustodialWalletProvisioner>().ImportHardhatWalletsAsync(CancellationToken.None);
            if (imported > 0) app.Logger.LogInformation("Imported {Count} existing Hardhat wallets into custody.", imported);
        }
    }
    catch (Exception exception)
    {
        app.Logger.LogError(exception, "Database initialization failed. Swagger remains available; readiness must pass before proceeding.");
    }
}

// One-shot step of scripts/demo-run.ps1: the API exits afterwards, so nothing is using the data being removed.
var demoReset = args.FirstOrDefault(argument => argument.StartsWith("--demo-reset=", StringComparison.Ordinal));
if (demoReset is not null)
{
    if (!app.Environment.IsDevelopment()) throw new InvalidOperationException("The demo reset is allowed only in Development.");
    await using var scope = app.Services.CreateAsyncScope();
    var reset = await StudentEscrow.Infrastructure.Demo.DemoReset.RunAsync(scope.ServiceProvider.GetRequiredService<StudentEscrowDbContext>(), CancellationToken.None);
    await File.WriteAllTextAsync(demoReset["--demo-reset=".Length..], System.Text.Json.JsonSerializer.Serialize(reset.KycVerifiedWallets));
    app.Logger.LogInformation("Demo reset done. Backup: {Backup}. Wallets with verified KYC: {Count}.", reset.BackupFile, reset.KycVerifiedWallets.Count);
    return;
}

app.UseExceptionHandler();
app.UseStatusCodePages(async context =>
{
    var response = context.HttpContext.Response;
    await response.WriteAsJsonAsync(new ApiError(
        response.StatusCode == 404 ? "NOT_FOUND" : "REQUEST_FAILED",
        response.StatusCode == 404 ? "API không tồn tại." : "Yêu cầu không được xử lý.",
        context.HttpContext.TraceIdentifier));
});
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}
else
{
    app.UseHttpsRedirection();
}

app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();
app.MapControllers();
app.MapGet("/", () => Results.Redirect("/swagger")).ExcludeFromDescription();
app.Run();

public partial class Program { }
