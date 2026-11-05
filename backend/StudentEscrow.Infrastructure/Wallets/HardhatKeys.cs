using Nethereum.HdWallet;

namespace StudentEscrow.Infrastructure.Wallets;

// Hardhat's published default mnemonic: every key here is public, so these wallets hold test funds only.
// Callers are limited to Development and a loopback chain 31337 by the checks in Program.cs.
public static class HardhatKeys
{
    private const string Mnemonic = "test test test test test test test test test test test junk";
    public const int AccountCount = 20;
    // The Admin wallet: the demo starts with ETH only here, and it also collects the platform fee.
    public const int TreasuryIndex = 0;

    public static byte[] PrivateKey(int index) => new Wallet(Mnemonic, "").GetPrivateKey(index);
    public static string Address(int index) => new Wallet(Mnemonic, "").GetAccount(index).Address.ToLowerInvariant();
}
