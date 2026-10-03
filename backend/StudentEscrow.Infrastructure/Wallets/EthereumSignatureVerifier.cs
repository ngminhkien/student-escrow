using System.Text.RegularExpressions;
using Nethereum.Signer;
using Nethereum.Util;
using StudentEscrow.Application.Common;
using StudentEscrow.Application.Wallets;

namespace StudentEscrow.Infrastructure.Wallets;

public sealed class EthereumSignatureVerifier : IWalletSignatureVerifier
{
    public string NormalizeAddress(string address)
    {
        if (string.IsNullOrEmpty(address) || !Regex.IsMatch(address, "\\A0x[0-9a-fA-F]{40}\\z")
            || AddressUtil.Current.IsZeroAddress(address))
        {
            throw new ApplicationError("INVALID_ADDRESS", "Provide a nonzero Ethereum address.", 400);
        }

        var body = address[2..];
        if (body != body.ToLowerInvariant() && body != body.ToUpperInvariant()
            && !AddressUtil.Current.IsChecksumAddress(address))
        {
            throw new ApplicationError("INVALID_ADDRESS", "Mixed-case addresses must have a valid EIP-55 checksum.", 400);
        }

        return address.ToLowerInvariant();
    }

    public string ChecksumAddress(string address) => AddressUtil.Current.ConvertToChecksumAddress(address);

    public bool Verify(string message, string signature, string expectedAddress)
    {
        if (string.IsNullOrEmpty(signature) || !Regex.IsMatch(signature, "\\A0x[0-9a-fA-F]{130}\\z"))
        {
            return false;
        }

        var recoveryId = Convert.ToByte(signature[^2..], 16);
        if (recoveryId is 0 or 1)
        {
            signature = signature[..^2] + (recoveryId + 27).ToString("x2");
        }
        else if (recoveryId is not (27 or 28))
        {
            return false;
        }

        try
        {
            var recovered = new EthereumMessageSigner().EncodeUTF8AndEcRecover(message, signature);
            return string.Equals(recovered, expectedAddress, StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception exception) when (exception is ArgumentException or FormatException or ArithmeticException)
        {
            return false;
        }
    }
}
