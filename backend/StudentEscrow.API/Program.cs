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
        Description = "Phần 2: tài khoản/JWT, liên kết ví EOA bằng chữ ký và KYC mock. VERIFIED chỉ là mô phỏng trong SQL; chưa có xác minh on-chain, giao dịch tiền hoặc AI."
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
    }
    catch (Exception exception)
    {
        app.Logger.LogError(exception, "Database initialization failed. Swagger remains available; readiness must pass before proceeding.");
    }
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
