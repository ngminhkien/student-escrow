import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { id, parseEther, sha256, toUtf8Bytes } from "ethers";
import { network } from "hardhat";

const manifest = JSON.parse(await readFile(new URL("local/latest.json", import.meta.url), "utf8"));
const connection = await network.create();
try {
  const { ethers, provider } = connection;
  assert.equal(connection.networkName, "localhost");
  assert.equal((await ethers.provider.getNetwork()).chainId.toString(), "31337");
  assert.equal(manifest.chainId, "31337");
  const deployedBlock = await ethers.provider.getBlock(manifest.deploymentBlock);
  assert.equal(deployedBlock?.hash, manifest.deploymentBlockHash, "Local chain reset: deploy again before smoke.");
  assert.notEqual(await ethers.provider.getCode(manifest.contractAddress), "0x", "Contract is absent: deploy again.");
  const [admin, buyer, seller, arbiter, platform] = await ethers.getSigners();
  for (const [role, signer] of Object.entries({ admin, buyer, seller, arbiter, platform })) assert.equal(manifest.roles[role], signer.address);
  const escrow: any = await ethers.getContractAt("Escrow", manifest.contractAddress, admin);
  assert.equal(await escrow.platformWallet(), platform.address);
  assert.equal(await escrow.hasRole(await escrow.KYC_ADMIN_ROLE(), admin.address), true);
  const balance = async (address: string) => BigInt(await provider.request({ method: "eth_getBalance", params: [address, "latest"] }) as string);
  const initialLocked = await escrow.totalLockedWei();
  for (const wallet of [buyer.address, seller.address]) await (await escrow.setWalletVerified(wallet, true)).wait();
  console.log("PASS Admin on-chain verification of Buyer and Seller");
  const value = parseEther("0.01");
  const runId = randomUUID();
  for (const scenario of ["complete", "split", "refund", "review-timeout"] as const) {
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const orderId = await escrow.nextOrderId();
    const created = await (await escrow.connect(buyer).createOrder(seller.address, arbiter.address, value, id(`${runId}-${scenario}`), sha256(toUtf8Bytes("demo agreed terms")), now + 3600, 300)).wait();
    assert.equal(created.status, 1);
    assert.equal((await escrow.getOrder(orderId)).state, 0n);
    await (await escrow.connect(buyer).deposit(orderId, { value })).wait();
    assert.equal(await escrow.totalLockedWei(), initialLocked + value);
    const buyerBefore = await balance(buyer.address), sellerBefore = await balance(seller.address), feeBefore = await balance(platform.address);
    let receipt: any;
    let sellerGas = 0n, buyerGas = 0n;
    if (scenario === "refund") {
      await provider.request({ method: "evm_setNextBlockTimestamp", params: [Number((await escrow.getOrder(orderId)).deliveryDeadline) + 1] });
      receipt = await (await escrow.connect(buyer).refundIfExpired(orderId)).wait();
      buyerGas += receipt.fee;
    } else {
      const delivery = await (await escrow.connect(seller).markDelivered(orderId, sha256(toUtf8Bytes("demo delivery bytes")))).wait();
      sellerGas += delivery.fee;
      if (scenario === "complete") {
        receipt = await (await escrow.connect(buyer).confirmReceipt(orderId)).wait();
        buyerGas += receipt.fee;
      } else if (scenario === "split") {
        const dispute = await (await escrow.connect(buyer).raiseDispute(orderId)).wait();
        buyerGas += dispute.fee;
        receipt = await (await escrow.connect(arbiter).resolveDispute(orderId, 7000)).wait();
      } else {
        await provider.request({ method: "evm_setNextBlockTimestamp", params: [Number((await escrow.getOrder(orderId)).reviewDeadline) + 1] });
        receipt = await (await escrow.connect(seller).claimAfterReviewTimeout(orderId)).wait();
        sellerGas += receipt.fee;
      }
    }
    const share = scenario === "refund" ? 0n : scenario === "split" ? 7000n : 10000n;
    const gross = value * share / 10000n, refund = value - gross, fee = gross / 100n;
    assert.equal(await balance(buyer.address) - buyerBefore + buyerGas, refund);
    assert.equal(await balance(seller.address) - sellerBefore + sellerGas, gross - fee);
    assert.equal(await balance(platform.address) - feeBefore, fee);
    assert.equal(await escrow.totalLockedWei(), initialLocked);
    assert.equal((await escrow.getOrder(orderId)).state, scenario === "refund" ? 6n : scenario === "split" ? 5n : 3n);
    console.log(`PASS ${scenario}, order ${orderId}, tx ${receipt.hash}`);
  }
  console.log("Local blockchain smoke checks passed. These are local test ETH transactions, not Sepolia or SQL synchronization.");
} finally {
  await connection.close();
}
