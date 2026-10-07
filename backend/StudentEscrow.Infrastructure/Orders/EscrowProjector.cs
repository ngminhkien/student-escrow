using System.Globalization;
using System.Numerics;
using System.Text.Json;
using Nethereum.Util;
using StudentEscrow.Domain.Orders;

namespace StudentEscrow.Infrastructure.Orders;

public static class EscrowProjector
{
    private static readonly (string Name, string Signature, int Topics, int Words)[] Events =
    [
        ("OrderCreated", "OrderCreated(uint256,bytes32,address,address,address,uint256,uint256,bytes32,uint256,uint256)", 4, 7),
        ("Deposited", "Deposited(uint256,uint256)", 2, 1),
        ("Delivered", "Delivered(uint256,bytes32,uint256,uint256)", 2, 3),
        ("Disputed", "Disputed(uint256,address)", 3, 0),
        ("Released", "Released(uint256,uint256,uint256,uint256)", 2, 3),
        ("Resolved", "Resolved(uint256,uint256,uint256,uint256,uint256)", 2, 4),
        ("Refunded", "Refunded(uint256,uint256)", 2, 1),
        ("WalletVerificationUpdated", "WalletVerificationUpdated(address,bool)", 2, 1)
    ];
    public static string Topic(string signature) => "0x" + Sha3Keccack.Current.CalculateHash(signature);
    public static string Integer(string word) => BigInteger.Parse("0" + word.Replace("0x", ""), NumberStyles.HexNumber)
        .ToString(CultureInfo.InvariantCulture);
    public static ChainEvent? Decode(Guid deploymentId, RpcLog log)
    {
        var definition = Events.FirstOrDefault(e => log.Topics.Length > 0 && Topic(e.Signature) == log.Topics[0]);
        if (definition.Name is null) return null; // AccessControl events are not order events.
        if (log.Removed || log.Topics.Length != definition.Topics || log.Data.Length != 2 + definition.Words * 64
            || !log.Data.StartsWith("0x") || !log.Data[2..].All(Uri.IsHexDigit)
            || log.Topics.Any(t => t.Length != 66 || !t.StartsWith("0x") || !t[2..].All(Uri.IsHexDigit)))
            throw new InvalidDataException("Malformed escrow event.");
        return new ChainEvent { DeploymentId = deploymentId, TransactionHash = log.TransactionHash,
            LogIndex = log.LogIndex, BlockNumber = log.BlockNumber, BlockHash = log.BlockHash,
            Name = definition.Name, OrderId = definition.Name == "WalletVerificationUpdated" ? null : Integer(log.Topics[1]),
            Payload = JsonSerializer.Serialize(log) };
    }
    public static ChainOrder Apply(ChainEvent ev, ChainOrder? order)
    {
        var log = JsonSerializer.Deserialize<RpcLog>(ev.Payload)!;
        string Word(int index) => "0x" + log.Data.Substring(2 + index * 64, 64).ToLowerInvariant();
        string Num(int index) => Integer(Word(index));
        long Long(int index) => checked((long)BigInteger.Parse(Num(index), CultureInfo.InvariantCulture));
        if (ev.Name == "OrderCreated")
        {
            if (order is not null || Num(3) != "100") throw new InvalidDataException("Duplicate order or unsupported fee.");
            return new ChainOrder { DeploymentId = ev.DeploymentId, OrderId = ev.OrderId!,
                ClientReference = log.Topics[2].ToLowerInvariant(), Buyer = "0x" + log.Topics[3][26..].ToLowerInvariant(),
                Seller = "0x" + Word(0)[26..], Arbiter = "0x" + Word(1)[26..], AmountWei = Num(2),
                TermsHash = Word(4), DeliveryDeadline = Long(5), ReviewWindow = Long(6) };
        }
        if (order is null) throw new InvalidDataException("Order event without OrderCreated.");
        var allowed = ev.Name switch
        {
            "Deposited" => order.State == "Created" && Num(0) == order.AmountWei,
            "Delivered" or "Refunded" => order.State == "Funded",
            "Disputed" => order.State is "Funded" or "Delivered",
            "Released" => order.State == "Delivered",
            "Resolved" => order.State == "Disputed",
            _ => false
        };
        if (!allowed) throw new InvalidDataException("Invalid escrow event sequence.");
        switch (ev.Name)
        {
            case "Deposited": order.State = "Funded"; break;
            case "Delivered": order.State = "Delivered"; order.DeliveryHash = Word(0); order.ReviewDeadline = Long(2); break;
            case "Disputed": order.State = "Disputed"; break;
            case "Released": order.State = "Completed"; order.SellerNetWei = Num(1); order.PlatformFeeWei = Num(2); break;
            case "Resolved": order.State = "Resolved"; order.BuyerRefundWei = Num(0); order.SellerNetWei = Num(2); order.PlatformFeeWei = Num(3); break;
            case "Refunded": order.State = "Refunded"; order.BuyerRefundWei = Num(0); break;
        }
        if (order.State is "Completed" or "Resolved" or "Refunded"
            && BigInteger.Parse(order.BuyerRefundWei) + BigInteger.Parse(order.SellerNetWei) + BigInteger.Parse(order.PlatformFeeWei)
                != BigInteger.Parse(order.AmountWei)) throw new InvalidDataException("Settlement does not conserve wei.");
        return order;
    }
}
