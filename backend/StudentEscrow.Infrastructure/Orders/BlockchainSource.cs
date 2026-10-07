using System.Globalization;
using System.Numerics;
using System.Text.Json;
using Nethereum.JsonRpc.Client;
using Newtonsoft.Json.Linq;

namespace StudentEscrow.Infrastructure.Orders;

public sealed class BlockchainSettings
{
    public bool Enabled { get; set; }
    public string RpcUrl { get; set; } = "http://127.0.0.1:8545";
    public string ManifestPath { get; set; } = "../../blockchain/deployment/local/latest.json";
    public int Confirmations { get; set; } = 0;
    public int PollSeconds { get; set; } = 2;
    public int BatchSize { get; set; } = 50;
}

public sealed record DeploymentManifest(Guid DeploymentId, string ChainId, string ContractAddress,
    long DeploymentBlock, string DeploymentBlockHash, string TransactionHash);

public sealed class ManifestProvider(BlockchainSettings settings)
{
    public async Task<DeploymentManifest> ReadAsync(CancellationToken ct)
    {
        if (!settings.Enabled) throw new InvalidOperationException("Blockchain synchronization is disabled.");
        using var file = File.OpenRead(settings.ManifestPath);
        var manifest = await JsonSerializer.DeserializeAsync<DeploymentManifest>(file,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true }, ct)
            ?? throw new InvalidDataException("Missing deployment manifest.");
        if (manifest.DeploymentId == Guid.Empty || manifest.ChainId != "31337" || manifest.DeploymentBlock < 1
            || !Hex(manifest.ContractAddress, 40) || !Hex(manifest.DeploymentBlockHash, 64) || !Hex(manifest.TransactionHash, 64))
            throw new InvalidDataException("Invalid local deployment manifest.");
        return manifest with { ContractAddress = manifest.ContractAddress.ToLowerInvariant(),
            DeploymentBlockHash = manifest.DeploymentBlockHash.ToLowerInvariant(), TransactionHash = manifest.TransactionHash.ToLowerInvariant() };
    }
    private static bool Hex(string? value, int digits) => value is not null && value.Length == digits + 2
        && value.StartsWith("0x") && value[2..].All(Uri.IsHexDigit);
}

public sealed record RpcBlock(long Number, string Hash, string ParentHash);
public sealed record RpcLog(long BlockNumber, string BlockHash, string TransactionHash, int LogIndex,
    string Address, string[] Topics, string Data, bool Removed);

public interface IBlockchainSource
{
    Task<long> HeadAsync(CancellationToken ct);
    Task<RpcBlock?> BlockAsync(long number, CancellationToken ct);
    Task<bool> ValidateDeploymentAsync(DeploymentManifest manifest, CancellationToken ct);
    Task<IReadOnlyList<RpcLog>> LogsAsync(string address, long block, CancellationToken ct);
}

// Read-only Nethereum client. No private keys or transaction signing in the server.
public sealed class NethereumSource(BlockchainSettings settings) : IBlockchainSource
{
    private readonly RpcClient client = new(new Uri(settings.RpcUrl));
    private async Task<T> Rpc<T>(string method, CancellationToken ct, params object[] args) =>
        await client.SendRequestAsync<T>(new RpcRequest(Guid.NewGuid().ToString("N"), method, args))
            .WaitAsync(TimeSpan.FromSeconds(15), ct);
    public static long Number(string hex) => checked((long)BigInteger.Parse("0" + hex[2..], NumberStyles.HexNumber));
    private static string Hex(long number) => "0x" + number.ToString("x", CultureInfo.InvariantCulture);
    public async Task<long> HeadAsync(CancellationToken ct) => Number(await Rpc<string>("eth_blockNumber", ct));
    public async Task<RpcBlock?> BlockAsync(long number, CancellationToken ct)
    {
        var block = await Rpc<JObject?>("eth_getBlockByNumber", ct, Hex(number), false);
        return block is null ? null : new(Number((string)block["number"]!), (string)block["hash"]!, (string)block["parentHash"]!);
    }
    public async Task<bool> ValidateDeploymentAsync(DeploymentManifest m, CancellationToken ct)
    {
        if (Number(await Rpc<string>("eth_chainId", ct)) != 31337) return false;
        var block = await BlockAsync(m.DeploymentBlock, ct);
        if (block?.Hash != m.DeploymentBlockHash) return false;
        var receipt = await Rpc<JObject?>("eth_getTransactionReceipt", ct, m.TransactionHash);
        return receipt is not null && (string?)receipt["status"] == "0x1"
            && (string?)receipt["blockHash"] == m.DeploymentBlockHash
            && string.Equals((string?)receipt["contractAddress"], m.ContractAddress, StringComparison.OrdinalIgnoreCase)
            && await Rpc<string>("eth_getCode", ct, m.ContractAddress, "latest") != "0x";
    }
    public async Task<IReadOnlyList<RpcLog>> LogsAsync(string address, long block, CancellationToken ct)
    {
        var logs = await Rpc<JArray>("eth_getLogs", ct, new { address, fromBlock = Hex(block), toBlock = Hex(block) });
        return logs.Select(log => new RpcLog(Number((string)log["blockNumber"]!), (string)log["blockHash"]!,
            (string)log["transactionHash"]!, checked((int)Number((string)log["logIndex"]!)),
            ((string)log["address"]!).ToLowerInvariant(), log["topics"]!.Values<string>().Select(v => v!).ToArray(),
            (string)log["data"]!, (bool?)log["removed"] ?? false)).OrderBy(l => l.LogIndex).ToArray();
    }
}
