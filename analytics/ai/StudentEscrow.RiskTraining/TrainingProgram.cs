using System.Globalization;
using System.Text.Json;
using Microsoft.ML;
using Microsoft.ML.Data;
using Microsoft.ML.Trainers;
using StudentEscrow.Application.Risk;
using StudentEscrow.Infrastructure.Risk;

namespace StudentEscrow.RiskTraining;

// Offline only. Run from the repo root: scripts/dotnet.ps1 run --project analytics/ai/StudentEscrow.RiskTraining
public static class TrainingProgram
{
    private const string ModelVersion = "logistic-v1";
    private static readonly double[] L2Candidates = [0.0001, 0.001, 0.01, 0.1, 1];
    private static readonly JsonSerializerOptions Json = new(JsonSerializerOptions.Web) { WriteIndented = true };

    public static int Main(string[] args)
    {
        var seed = args.Length > 0 ? int.Parse(args[0], CultureInfo.InvariantCulture) : 20261105;
        var root = args.Length > 1 ? Path.GetFullPath(args[1]) : Directory.GetCurrentDirectory();
        var modelDirectory = Path.Combine(root, "analytics", "ai", "model");
        var dataDirectory = Path.Combine(root, "analytics", "data");
        Directory.CreateDirectory(modelDirectory);
        Directory.CreateDirectory(dataDirectory);

        var orders = Simulator.Run(seed, [("train", 210), ("validation", 70), ("test", 70)]);
        Simulator.WriteDataset(Path.Combine(dataDirectory, "risk-dataset.csv"), orders);
        // A separate run for the dashboard, so no order the model trained on is counted as dashboard data.
        Simulator.WriteAnalyticsSeed(Path.Combine(dataDirectory, "analytics-seed.csv"), Simulator.Run(seed + 1, [("demo", 60)]),
            Simulator.Start.AddDays(Simulator.HorizonDays));

        List<SimulatedOrder> Split(string name) => orders.Where(order => order.Split == name).ToList();
        var (train, validation, test) = (Split("train"), Split("validation"), Split("test"));

        var context = new MLContext(seed);
        // Normalization is inside the pipeline, so it is fitted on train only and travels with the model.
        var trainView = View(context, train);
        var candidates = L2Candidates.Select(l2 =>
        {
            var model = Pipeline(context, l2).Fit(trainView);
            return (L2: l2, Model: model, Auc: BinaryMetrics.RocAuc(Scores(context, model, validation)));
        }).ToList();
        var best = candidates.OrderByDescending(item => item.Auc).ThenByDescending(item => item.L2).First();

        var validationScores = Scores(context, best.Model, validation);
        var thresholds = Enumerable.Range(1, 19).Select(step => step * 0.05).ToArray();
        var modelThreshold = BinaryMetrics.BestThreshold(validationScores, thresholds);
        var baselineValidation = Baseline(validation);
        var baselineThreshold = BinaryMetrics.BestThreshold(baselineValidation, baselineValidation.Select(row => row.Score).Where(score => score > 0).Distinct());

        // From here on nothing is chosen. The test set is only measured.
        var testScores = Scores(context, best.Model, test);
        var baselineTest = Baseline(test);
        var mlNet = context.BinaryClassification.Evaluate(best.Model.Transform(View(context, test)));

        var modelPath = Path.Combine(modelDirectory, MlRiskModel.ModelFile);
        context.Model.Save(best.Model, trainView.Schema, modelPath);
        var trainedAt = DateTimeOffset.UtcNow;
        var metadata = new RiskModelMetadata
        {
            ModelVersion = ModelVersion, FeatureVersion = RiskFeatures.Version, FeatureNames = [.. RiskFeatures.Names],
            ModelSha256 = MlRiskModel.Sha256Of(modelPath), DataSource = "synthetic", TrainedAt = trainedAt, Seed = seed,
            MlNetVersion = typeof(MLContext).Assembly.GetName().Version?.ToString() ?? "", Trainer = "SdcaLogisticRegression",
            L2Regularization = best.L2, ValidationThreshold = modelThreshold,
            BaselineRules = new()
            {
                ["minimumHistory"] = RuleBasedRisk.MinimumHistory,
                ["newAccountDays"] = RuleBasedRisk.NewAccountDays, ["newAccountPoints"] = RuleBasedRisk.NewAccountPoints,
                ["disputeRateLimit"] = RuleBasedRisk.DisputeRateLimit, ["disputePoints"] = RuleBasedRisk.DisputePoints,
                ["refundRateLimit"] = RuleBasedRisk.RefundRateLimit, ["refundPoints"] = RuleBasedRisk.RefundPoints,
                ["amountRatioLimit"] = RuleBasedRisk.AmountRatioLimit, ["amountPoints"] = RuleBasedRisk.AmountPoints,
                ["frequencyLimit"] = RuleBasedRisk.FrequencyLimit, ["frequencyPoints"] = RuleBasedRisk.FrequencyPoints
            }
        };
        File.WriteAllText(Path.Combine(modelDirectory, MlRiskModel.MetadataFile), JsonSerializer.Serialize(metadata, Json));

        var metrics = new
        {
            seed, trainedAt, dataSource = "synthetic",
            samples = new { train = Describe(train), validation = Describe(validation), test = Describe(test) },
            selection = new
            {
                candidates = candidates.Select(item => new { l2 = item.L2, validationAuc = item.Auc }),
                chosenL2 = best.L2, modelThreshold, baselineThreshold
            },
            test = new
            {
                model = new
                {
                    rocAuc = BinaryMetrics.RocAuc(testScores), mlNetRocAuc = mlNet.AreaUnderRocCurve, logLoss = mlNet.LogLoss,
                    atDefaultThreshold = BinaryMetrics.At(testScores, 0.5), atValidationThreshold = BinaryMetrics.At(testScores, modelThreshold),
                    levels = Levels(testScores.Select(row => RiskLevels.ScoreOf(row.Score)))
                },
                baseline = new
                {
                    rocAuc = BinaryMetrics.RocAuc(baselineTest), atMediumLevel = BinaryMetrics.At(baselineTest, 40), atValidationThreshold = BinaryMetrics.At(baselineTest, baselineThreshold),
                    levels = Levels(baselineTest.Select(row => (int)row.Score))
                }
            },
            standardizedWeights = RiskFeatures.Names.Zip(best.Model.LastTransformer.Model.SubModel.Weights).ToDictionary(pair => pair.First, pair => pair.Second)
        };
        var report = JsonSerializer.Serialize(metrics, Json);
        File.WriteAllText(Path.Combine(modelDirectory, "metrics.json"), report);
        Console.WriteLine(report);
        return 0;
    }

    private static IEstimator<TransformerChain<BinaryPredictionTransformer<Microsoft.ML.Calibrators.CalibratedModelParametersBase<LinearBinaryModelParameters, Microsoft.ML.Calibrators.PlattCalibrator>>>> Pipeline(MLContext context, double l2) =>
        context.Transforms.Concatenate("Features", [.. RiskFeatures.Names])
            .Append(context.Transforms.NormalizeMeanVariance("Features"))
            .Append(context.BinaryClassification.Trainers.SdcaLogisticRegression(new SdcaLogisticRegressionBinaryTrainer.Options
            {
                LabelColumnName = nameof(RiskModelInput.Label), FeatureColumnName = "Features",
                L2Regularization = (float)l2, MaximumNumberOfIterations = 200,
                NumberOfThreads = 1 // SDCA is only reproducible for a fixed seed on one thread.
            }));

    private static IDataView View(MLContext context, IEnumerable<SimulatedOrder> orders) =>
        context.Data.LoadFromEnumerable(orders.Select(order => RiskModelInput.From(order.Features, order.RiskLabel)).ToList());

    private static List<(double Score, bool Label)> Scores(MLContext context, ITransformer model, IReadOnlyList<SimulatedOrder> orders)
    {
        var engine = context.Model.CreatePredictionEngine<RiskModelInput, RiskModelOutput>(model);
        return orders.Select(order => ((double)engine.Predict(RiskModelInput.From(order.Features)).Probability, order.RiskLabel)).ToList();
    }

    private static List<(double Score, bool Label)> Baseline(IEnumerable<SimulatedOrder> orders) =>
        orders.Select(order => ((double)RuleBasedRisk.Evaluate(order.Features).Score, order.RiskLabel)).ToList();

    private static object Describe(IReadOnlyCollection<SimulatedOrder> orders) => new
    {
        orders = orders.Count, sellers = orders.Select(order => order.Seller).Distinct().Count(), buyers = orders.Select(order => order.Buyer).Distinct().Count(),
        positiveLabels = orders.Count(order => order.RiskLabel), positiveRate = orders.Count(order => order.RiskLabel) / (double)orders.Count
    };

    private static object Levels(IEnumerable<int> scores)
    {
        var groups = scores.GroupBy(RiskLevels.Of).ToDictionary(group => group.Key, group => group.Count());
        return new { low = groups.GetValueOrDefault(RiskLevels.Low), medium = groups.GetValueOrDefault(RiskLevels.Medium), high = groups.GetValueOrDefault(RiskLevels.High) };
    }
}
