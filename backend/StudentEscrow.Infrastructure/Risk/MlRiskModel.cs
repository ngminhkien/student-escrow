using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.ObjectPool;
using Microsoft.ML;
using StudentEscrow.Application.Risk;

namespace StudentEscrow.Infrastructure.Risk;

public sealed class RiskSettings
{
    public string ModelDirectory { get; set; } = "../../analytics/ai/model";
    public string SyntheticDataPath { get; set; } = "../../analytics/data/analytics-seed.csv";
}

// Shared with the training console: pipeline column names are these property names.
public sealed class RiskModelInput
{
    public float AmountEth { get; set; }
    public float BuyerAccountAgeDays { get; set; }
    public float SellerAccountAgeDays { get; set; }
    public float SellerPriorFundedCount { get; set; }
    public float SellerPriorDisputeRate { get; set; }
    public float SellerPriorRefundRate { get; set; }
    public float SellerOrdersLast7Days { get; set; }
    public float AmountToSellerHistoricalMean { get; set; }
    public float SellerHistoryMissing { get; set; }
    public bool Label { get; set; }

    public static RiskModelInput From(RiskFeatures f, bool label = false) => new()
    {
        AmountEth = (float)f.AmountEth,
        BuyerAccountAgeDays = (float)f.BuyerAccountAgeDays,
        SellerAccountAgeDays = (float)f.SellerAccountAgeDays,
        SellerPriorFundedCount = f.SellerPriorFundedCount,
        SellerPriorDisputeRate = (float)f.SellerPriorDisputeRate,
        SellerPriorRefundRate = (float)f.SellerPriorRefundRate,
        SellerOrdersLast7Days = f.SellerOrdersLast7Days,
        AmountToSellerHistoricalMean = (float)f.AmountToSellerHistoricalMean,
        SellerHistoryMissing = f.SellerHistoryMissing ? 1 : 0,
        Label = label
    };
}

public sealed class RiskModelOutput
{
    public float Probability { get; set; }
}

public sealed class RiskModelMetadata
{
    public string ModelVersion { get; set; } = "";
    public string FeatureVersion { get; set; } = "";
    public string[] FeatureNames { get; set; } = [];
    public string ModelSha256 { get; set; } = "";
    public string DataSource { get; set; } = "";
    public DateTimeOffset TrainedAt { get; set; }
    public int Seed { get; set; }
    public string MlNetVersion { get; set; } = "";
    public string Trainer { get; set; } = "";
    public double L2Regularization { get; set; }
    public double ValidationThreshold { get; set; }
    public Dictionary<string, double> BaselineRules { get; set; } = [];
}

// The API only ever loads what the console trained. A file that does not match its metadata is refused, and scoring falls back to the rules.
public sealed class MlRiskModel : IRiskModel
{
    public const string ModelFile = "risk-model.zip", MetadataFile = "metadata.json";
    private readonly ObjectPool<PredictionEngine<RiskModelInput, RiskModelOutput>>? engines;
    private readonly ILogger? logger;

    public string? Version { get; }
    public string? DataSource { get; }

    public MlRiskModel(string directory, ILogger? logger = null)
    {
        this.logger = logger;
        try
        {
            var metadata = JsonSerializer.Deserialize<RiskModelMetadata>(File.ReadAllText(Path.Combine(directory, MetadataFile)), JsonSerializerOptions.Web)
                ?? throw new InvalidDataException("Empty model metadata.");
            var path = Path.Combine(directory, ModelFile);
            if (metadata.FeatureVersion != RiskFeatures.Version || !metadata.FeatureNames.SequenceEqual(RiskFeatures.Names))
                throw new InvalidDataException($"Model features {metadata.FeatureVersion} do not match the API's {RiskFeatures.Version}.");
            if (!string.Equals(Sha256Of(path), metadata.ModelSha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Model file does not match the hash in its metadata.");
            var context = new MLContext();
            using var stream = File.OpenRead(path);
            var model = context.Model.Load(stream, out _);
            // PredictionEngine is not thread-safe, so each request borrows its own.
            engines = new DefaultObjectPool<PredictionEngine<RiskModelInput, RiskModelOutput>>(new EnginePolicy(context, model));
            Version = metadata.ModelVersion;
            DataSource = metadata.DataSource;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException
            or JsonException or InvalidOperationException or ArgumentException or FormatException)
        {
            logger?.LogWarning(exception, "Risk model unavailable; scoring falls back to the rule-based baseline.");
        }
    }

    public double? Predict(RiskFeatures features)
    {
        if (engines is null) return null;
        PredictionEngine<RiskModelInput, RiskModelOutput>? engine = null;
        try
        {
            engine = engines.Get();
            return engine.Predict(RiskModelInput.From(features)).Probability;
        }
        catch (Exception exception) when (exception is InvalidOperationException or ArgumentException or FormatException)
        {
            logger?.LogWarning(exception, "Risk model prediction failed; using the rule-based baseline.");
            return null;
        }
        finally
        {
            if (engine is not null) engines.Return(engine);
        }
    }

    public static string Sha256Of(string path)
    {
        using var stream = File.OpenRead(path);
        return Convert.ToHexStringLower(SHA256.HashData(stream));
    }

    private sealed class EnginePolicy(MLContext context, ITransformer model) : IPooledObjectPolicy<PredictionEngine<RiskModelInput, RiskModelOutput>>
    {
        public PredictionEngine<RiskModelInput, RiskModelOutput> Create() => context.Model.CreatePredictionEngine<RiskModelInput, RiskModelOutput>(model);
        public bool Return(PredictionEngine<RiskModelInput, RiskModelOutput> obj) => true;
    }
}
