import { network, artifacts } from "hardhat";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const connection = await network.create();
try {
  const { ethers } = connection;
  const chain = await ethers.provider.getNetwork();
  if (chain.chainId !== 31337n || connection.networkName !== "localhost") {
    throw new Error("This script only deploys to the configured localhost chain 31337.");
  }
  const [admin, buyer, seller, arbiter, platform] = await ethers.getSigners();
  const escrow = await ethers.deployContract("Escrow", [admin.address, platform.address]);
  await escrow.waitForDeployment();
  const receipt = await escrow.deploymentTransaction()!.wait();
  if (!receipt || receipt.status !== 1) throw new Error("Deployment receipt failed.");
  const artifact = await artifacts.readArtifact("Escrow");
  const manifest = {
    deploymentId: randomUUID(), network: "localhost", chainId: chain.chainId.toString(),
    contractAddress: await escrow.getAddress(), deploymentBlock: receipt.blockNumber,
    deploymentBlockHash: receipt.blockHash, transactionHash: receipt.hash,
    deployedAt: new Date().toISOString(), compiler: "0.8.28", platformFeeBps: 100,
    roles: { admin: admin.address, buyer: buyer.address, seller: seller.address, arbiter: arbiter.address, platform: platform.address },
    abi: artifact.abi,
  };
  const directory = new URL("local/", import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL(`${manifest.deploymentId}.json`, directory), JSON.stringify(manifest, null, 2) + "\n");
  await writeFile(new URL("latest.json", directory), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Local deployment ${manifest.deploymentId}: ${manifest.contractAddress}, block ${receipt.blockNumber}`);
  console.log("Manifest saved in deployment/local/latest.json. Wallet verification is still false until an Admin attests.");
} finally {
  await connection.close();
}
