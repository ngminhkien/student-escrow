namespace StudentEscrow.RiskTraining;

public sealed record ConfusionMetrics(double Threshold, int TruePositive, int FalsePositive, int TrueNegative, int FalseNegative,
    double Precision, double Recall, double F1);

public static class BinaryMetrics
{
    public static ConfusionMetrics At(IReadOnlyList<(double Score, bool Label)> rows, double threshold)
    {
        int tp = 0, fp = 0, tn = 0, fn = 0;
        foreach (var (score, label) in rows)
        {
            if (score >= threshold) { if (label) tp++; else fp++; }
            else { if (label) fn++; else tn++; }
        }
        var precision = tp + fp == 0 ? 0 : (double)tp / (tp + fp);
        var recall = tp + fn == 0 ? 0 : (double)tp / (tp + fn);
        return new(threshold, tp, fp, tn, fn, precision, recall, precision + recall == 0 ? 0 : 2 * precision * recall / (precision + recall));
    }

    // Chance that a random positive outranks a random negative, with ties counted as half. The baseline's coarse score has many ties.
    public static double RocAuc(IReadOnlyList<(double Score, bool Label)> rows)
    {
        var positives = rows.Count(row => row.Label);
        var negatives = rows.Count - positives;
        if (positives == 0 || negatives == 0) return double.NaN;
        var sorted = rows.OrderBy(row => row.Score).ToList();
        double rankSum = 0;
        for (var start = 0; start < sorted.Count;)
        {
            var end = start;
            while (end + 1 < sorted.Count && sorted[end + 1].Score == sorted[start].Score) end++;
            var rank = (start + end) / 2.0 + 1;
            for (var index = start; index <= end; index++) if (sorted[index].Label) rankSum += rank;
            start = end + 1;
        }
        return (rankSum - positives * (positives + 1) / 2.0) / ((double)positives * negatives);
    }

    public static double BestThreshold(IReadOnlyList<(double Score, bool Label)> rows, IEnumerable<double> candidates) =>
        candidates.Select(candidate => At(rows, candidate)).OrderByDescending(metrics => metrics.F1).ThenBy(metrics => metrics.Threshold).First().Threshold;
}
