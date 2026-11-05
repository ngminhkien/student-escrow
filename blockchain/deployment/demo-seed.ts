import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { network } from "hardhat";

// Second half of scripts/demo-run.ps1, on a chain deployed moments ago: balances come only from deposits, and verified KYC becomes an on-chain attestation.
const walletsFile = process.env.ESCROW_KYC_WALLETS;
assert.ok(walletsFile, "ESCROW_KYC_WALLETS must name the file written by the demo reset");
const wallets: string[] = JSON.parse(await readFile(walletsFile, "utf8"));
const manifest = JSON.parse(await readFile(new URL("local/latest.json", import.meta.url), "utf8"));
const connection = await network.create();
try {
  const { ethers, provider } = connection;
  assert.equal(connection.networkName, "localhost");
  assert.equal((await ethers.provider.getNetwork()).chainId, 31337n);
  const [admin, ...others] = await ethers.getSigners();
  for (const signer of others) await provider.request({ method: "hardhat_setBalance", params: [signer.address, "0x0"] });
  console.log(`Only the Admin wallet ${admin.address} holds ETH now.`);
  const escrow: any = await ethers.getContractAt("Escrow", manifest.contractAddress, admin);
  for (const wallet of wallets) {
    const receipt = await (await escrow.setWalletVerified(wallet, true)).wait();
    assert.equal(receipt.status, 1);
    console.log(`Verified ${wallet}, tx ${receipt.hash}`);
  }
  console.log(`${wallets.length} wallet(s) with verified KYC attested on chain.`);
  const approval = await (await escrow.setArbiterApproved(admin.address, true)).wait();
  assert.equal(approval.status, 1);
  console.log(`Admin ${admin.address} is the default Arbiter, tx ${approval.hash}`);
} finally {
  await connection.close();
}
