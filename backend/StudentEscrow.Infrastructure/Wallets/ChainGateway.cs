using System.Globalization;
using System.Numerics;
using System.Text.RegularExpressions;
using Nethereum.JsonRpc.Client;
using Nethereum.Signer;
using Nethereum.Util;
using Newtonsoft.Json.Linq;
using StudentEscrow.Infrastructure.Orders;

namespace StudentEscrow.Infrastructure.Wallets;

// NotExecuted is what lets the caller safely return held funds; an unknown outcome must keep them held.
public sealed class ChainTransactionException(string message, bool notExecuted, string? revertName = null) : Exception(message)
{
    public bool NotExecuted { get; } = notExecuted;
    public string? RevertName { get; } = revertName;
}

public interface IChainGateway
{
    Task<BigInteger> BalanceAsync(string address, CancellationToken ct);
    Task<string> CallAsync(string to, string data, CancellationToken ct);
    Task<string> SendAsync(byte[] privateKey, string from, string to, BigInteger value, string data, CancellationToken ct);
}

public static class TreasuryTransfers
{
    // The key comes from Hardhat's public mnemonic; the gateway only signs for the local chain.
    public static async Task<string> SendFromTreasuryAsync(this IChainGateway chain, string to, BigInteger value, CancellationToken ct)
    {
        var key = HardhatKeys.PrivateKey(HardhatKeys.TreasuryIndex);
        try { return await chain.SendAsync(key, HardhatKeys.Address(HardhatKeys.TreasuryIndex), to, value, "0x", ct); }
        finally { System.Security.Cryptography.CryptographicOperations.ZeroMemory(key); }
    }
}

// All Escrow inputs are static ABI types, so each one encodes to a single 32-byte word.
public static partial class EscrowCalls
{
    public static string Encode(string signature, params object[] arguments) =>
        "0x" + Sha3Keccack.Current.CalculateHash(signature)[..8] + string.Concat(arguments.Select(Word));

    public static string Selector(string signature) => "0x" + Sha3Keccack.Current.CalculateHash(signature)[..8];

    private static string Word(object value) => value switch
    {
        bool flag => flag ? new string('0', 63) + "1" : new string('0', 64),
        BigInteger number when number.Sign >= 0 => number.ToString("x", CultureInfo.InvariantCulture).TrimStart('0').PadLeft(64, '0'),
        long number => Word(new BigInteger(number)),
        int number => Word(new BigInteger(number)),
        string text when Hex().IsMatch(text) && text.Length == 42 => text[2..].ToLowerInvariant().PadLeft(64, '0'),
        string text when Hex().IsMatch(text) && text.Length == 66 => text[2..].ToLowerInvariant(),
        _ => throw new ArgumentException("Unsupported ABI argument.", nameof(value))
    };

    [GeneratedRegex("^0x[0-9a-fA-F]+$")]
    private static partial Regex Hex();
}

public sealed class NethereumChainGateway(BlockchainSettings settings) : IChainGateway
{
    private const long ChainId = CustodialWalletProvisioner.LocalChainId;
    // One sender at a time: nonces come from the node, and a demo API runs as a single process.
    private static readonly SemaphoreSlim SendLock = new(1, 1);
    private static readonly TimeSpan ReceiptTimeout = TimeSpan.FromSeconds(30);
    private static readonly string[] ErrorSignatures =
    [
        "WalletNotVerified(address)", "ArbiterNotApproved(address)", "DuplicateReference()", "InvalidState(uint8)", "Unauthorized()", "DeadlinePassed()",
        "DeadlineNotPassed()", "IncorrectDeposit(uint256,uint256)", "AccessControlUnauthorizedAccount(address,bytes32)",
        "InvalidParties()", "InvalidAmount()", "InvalidDeadline()", "InvalidReviewWindow()", "InvalidHash()", "InvalidShare()",
        "InvalidAddress()", "OrderNotFound(uint256)", "NothingToWithdraw()", "TransferFailed(address)"
    ];
    private readonly RpcClient client = new(new Uri(settings.RpcUrl));

    private async Task<T> Rpc<T>(string method, CancellationToken ct, params object[] args) =>
        await client.SendRequestAsync<T>(new RpcRequest(Guid.NewGuid().ToString("N"), method, args))
            .WaitAsync(TimeSpan.FromSeconds(15), ct);
    private static string Quantity(BigInteger value) => "0x" + value.ToString("x", CultureInfo.InvariantCulture).TrimStart('0').PadLeft(1, '0');
    private static BigInteger Parse(string hex) => BigInteger.Parse("0" + hex[2..], NumberStyles.HexNumber, CultureInfo.InvariantCulture);

    public async Task<BigInteger> BalanceAsync(string address, CancellationToken ct) =>
        Parse(await Rpc<string>("eth_getBalance", ct, address, "latest"));

    public Task<string> CallAsync(string to, string data, CancellationToken ct) =>
        Rpc<string>("eth_call", ct, new { to, data }, "latest");

    public async Task<string> SendAsync(byte[] privateKey, string from, string to, BigInteger value, string data, CancellationToken ct)
    {
        await SendLock.WaitAsync(ct);
        try
        {
            string raw;
            try
            {
                var gas = Parse(await Rpc<string>("eth_estimateGas", ct, new { from, to, value = Quantity(value), data }));
                var gasPrice = Parse(await Rpc<string>("eth_gasPrice", ct));
                var nonce = Parse(await Rpc<string>("eth_getTransactionCount", ct, from, "pending"));
                raw = new LegacyTransactionSigner().SignTransaction(privateKey, new BigInteger(ChainId), to, value, nonce,
                    gasPrice * 5 / 4, gas * 6 / 5, data);
            }
            catch (RpcResponseException exception)
            {
                var name = RevertName(exception);
                throw new ChainTransactionException(name ?? exception.Message, notExecuted: true, name);
            }
            catch (Exception exception) when (exception is RpcClientUnknownException or RpcClientTimeoutException or TimeoutException or HttpRequestException)
            {
                throw new ChainTransactionException("Không kết nối được blockchain.", notExecuted: true);
            }

            string hash;
            try { hash = await Rpc<string>("eth_sendRawTransaction", ct, "0x" + raw.Replace("0x", "")); }
            catch (RpcResponseException exception)
            {
                var name = RevertName(exception);
                throw new ChainTransactionException(name ?? exception.Message, notExecuted: true, name);
            }

            // From here the transaction may be mined, so the caller's cancellation no longer applies.
            var deadline = DateTime.UtcNow + ReceiptTimeout;
            while (DateTime.UtcNow < deadline)
            {
                JObject? receipt = null;
                try { receipt = await Rpc<JObject?>("eth_getTransactionReceipt", CancellationToken.None, hash); }
                catch (Exception exception) when (exception is RpcClientUnknownException or RpcClientTimeoutException or TimeoutException or HttpRequestException) { }
                if (receipt is not null)
                {
                    if ((string?)receipt["status"] == "0x1") return hash;
                    throw new ChainTransactionException("Giao dịch thất bại trên blockchain.", notExecuted: true);
                }
                await Task.Delay(250, CancellationToken.None);
            }
            throw new ChainTransactionException($"Chưa nhận được kết quả giao dịch {hash}.", notExecuted: false);
        }
        finally
        {
            SendLock.Release();
        }
    }

    private static string? RevertName(RpcResponseException exception)
    {
        var payload = exception.RpcError?.Data as JToken;
        var data = payload?.Type switch
        {
            JTokenType.String => (string?)payload,
            JTokenType.Object => (string?)payload["data"],
            _ => null
        };
        var match = data is { Length: >= 10 }
            ? ErrorSignatures.FirstOrDefault(signature => data.StartsWith(EscrowCalls.Selector(signature), StringComparison.OrdinalIgnoreCase))
            : null;
        if (match is not null) return match[..match.IndexOf('(')];
        return ErrorSignatures.Select(signature => signature[..signature.IndexOf('(')])
            .FirstOrDefault(name => exception.Message.Contains($"'{name}(", StringComparison.Ordinal));
    }
}
