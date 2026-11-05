import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { network } from "hardhat";

// An Admin on MetaMask and orders between the two wallet kinds, against a running API, SQL and local node.
// Run with CustodialWallet__ImportHardhatWallets off, on a fresh throwaway database: it links Hardhat wallets 0, 5 and 6.
const base = process.env.ESCROW_API_URL ?? "http://localhost:5180";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Smoke only supports a local API");
const password = "DemoPassword123!";
const VND = 10_000_000_000n;
const zip = Buffer.from("UEsDBBQAAAAAAKGYRl1YeXccKgAAACoAAAAKAAAAaW5kZXguaHRtbDwhZG9jdHlwZSBodG1sPjxoMT5TdHVkZW50RXNjcm93IGRlbW88L2gxPlBLAQIUABQAAAAAAKGYRl1YeXccKgAAACoAAAAKAAAAAAAAAAAAAACAAQAAAABpbmRleC5odG1sUEsFBgAAAAABAAEAOAAAAFIAAAAAAA==", "base64");

async function request(path: string, token?: string, method = "GET", body?: unknown, expected = 200): Promise<any> {
  const multipart = body instanceof FormData;
  const response = await fetch(`${base}/api${path}`, { method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(!multipart && body ? { "Content-Type": "application/json" } : {}) },
    body: body ? multipart ? body : JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) });
  const text = await response.text();
  assert.equal(response.status, expected, `${method} ${path}: ${text}`);
  return text && (response.headers.get("content-type") ?? "").includes("json") ? JSON.parse(text) : text;
}

const connection = await network.create();
try {
  const { ethers } = connection;
  assert.equal(connection.networkName, "localhost");
  const manifest = JSON.parse(await readFile(new URL("local/latest.json", import.meta.url), "utf8"));
  const signers = await ethers.getSigners();
  const run = randomUUID();

  async function custodial(role: string) {
    const email = `mixed.${run}.${role}@example.test`;
    const auth = await request("/auth/register", undefined, "POST", { email, fullName: `Mixed ${role}`, password }, 201);
    const wallet = await request("/wallets/me", auth.accessToken);
    assert.equal(wallet.custodial, true);
    return { token: auth.accessToken as string, address: wallet.address as string, email };
  }
  async function selfHeld(role: string, signer: any) {
    const email = `mixed.${run}.${role}@example.test`;
    const auth = await request("/auth/register", undefined, "POST", { email, fullName: `Mixed ${role}`, password, useExternalWallet: true }, 201);
    assert.equal((await request("/wallets/me", auth.accessToken)).linked, false, "Choosing MetaMask must not create a wallet");
    const challenge = await request("/wallets/challenges", auth.accessToken, "POST", { address: signer.address, chainId: 31337 });
    await request("/wallets/link", auth.accessToken, "POST", { challengeId: challenge.challengeId, signature: await signer.signMessage(challenge.message) });
    const wallet = await request("/wallets/me", auth.accessToken);
    assert.equal(wallet.custodial, false);
    assert.equal(wallet.address.toLowerCase(), signer.address.toLowerCase());
    const again = await request("/auth/login", undefined, "POST", { email, password });
    assert.equal((await request("/wallets/me", again.accessToken)).custodial, false, "Logging in must not move the account into custody");
    return { token: auth.accessToken as string, address: signer.address as string, email, signer };
  }

  const admin = await selfHeld("admin", signers[0]);
  const walletBuyer = await selfHeld("wallet-buyer", signers[5]);
  const walletSeller = await selfHeld("wallet-seller", signers[6]);
  const [ledgerBuyer, ledgerSeller, arbiter, outsider] = [await custodial("ledger-buyer"), await custodial("ledger-seller"), await custodial("arbiter"), await custodial("outsider")];
  const escrow: any = await ethers.getContractAt("Escrow", manifest.contractAddress, signers[0]);

  // Admin rights follow the on-chain role of the linked wallet, whichever kind it is.
  assert.ok((await request("/admin/accounts", admin.token)).accounts.some((row: any) => row.email === walletBuyer.email && row.custodial === false));
  await request("/admin/accounts", walletBuyer.token, "GET", undefined, 403);
  await request("/admin/accounts", outsider.token, "GET", undefined, 403);
  await request("/admin/wallets/credits", walletBuyer.token, "POST", { address: ledgerBuyer.address, amountVnd: 1000, reference: randomUUID() }, 403);
  // The server holds no key for this Admin, so it cannot sign in the Admin's name.
  assert.equal((await request("/admin/wallets/verification", admin.token, "POST", { address: ledgerBuyer.address, verified: true }, 409)).code, "CUSTODIAL_WALLET_REQUIRED");
  for (const actor of [walletBuyer, walletSeller, ledgerBuyer, ledgerSeller]) await (await escrow.setWalletVerified(actor.address, true)).wait();
  await (await escrow.setArbiterApproved(arbiter.address, true)).wait();

  const account = async (actor: { token: string }) => request("/wallets/account", actor.token);
  const balance = async (actor: { token: string }) => BigInt((await account(actor)).balanceWei) / VND;
  const reference = randomUUID();
  await request("/admin/wallets/credits", admin.token, "POST", { address: ledgerBuyer.address, amountVnd: 3_000_000, reference });
  assert.equal(await balance(ledgerBuyer), 3_000_000n);
  // A ledger balance has real ETH behind it, and its history points at the transaction that moved it.
  assert.ok(await ethers.provider.getBalance(ledgerBuyer.address) >= 3_000_000n * VND);
  const credited = (await account(ledgerBuyer)).entries[0];
  assert.equal((await ethers.provider.getTransactionReceipt(credited.transactionHash))?.status, 1);
  const paidIn = await request("/wallets/deposits", outsider.token, "POST", { amountVnd: 100_000, reference: randomUUID() });
  const settled = await request(`/wallets/deposits/${paidIn.id}/mock-payment`, outsider.token, "POST", { outcome: "Succeeded" });
  assert.equal(settled.payoutStatus, "Sent");
  assert.equal(await balance(outsider), 100_000n);
  assert.equal(await ethers.provider.getBalance(outsider.address), 100_000n * VND);
  assert.equal((await account(outsider)).entries[0].transactionHash, settled.payoutTransactionHash);
  console.log("PASS ledger deposits are backed by ETH on chain");
  // A self-held wallet has no ledger balance to add to.
  assert.equal((await request("/admin/wallets/credits", admin.token, "POST", { address: walletBuyer.address, amountVnd: 1000, reference: randomUUID() }, 409)).code, "CUSTODIAL_WALLET_REQUIRED");
  // Paying through the gateway sends ETH straight to a self-held wallet, and the ledger stays out of it.
  const walletBefore = await ethers.provider.getBalance(walletBuyer.address);
  const bought = await request("/wallets/deposits", walletBuyer.token, "POST", { amountVnd: 250_000, reference: randomUUID() });
  assert.equal(bought.payoutAddress.toLowerCase(), walletBuyer.address.toLowerCase());
  const delivered = await request(`/wallets/deposits/${bought.id}/mock-payment`, walletBuyer.token, "POST", { outcome: "Succeeded" });
  assert.equal(delivered.payoutStatus, "Sent");
  assert.equal(await ethers.provider.getBalance(walletBuyer.address) - walletBefore, 250_000n * VND, "The wallet receives exactly the amount paid");
  const payout = await ethers.provider.getTransactionReceipt(delivered.payoutTransactionHash);
  assert.equal(payout?.status, 1);
  assert.equal(payout?.to?.toLowerCase(), walletBuyer.address.toLowerCase());
  assert.equal((await account(walletBuyer)).entries.length, 0);
  await request(`/wallets/deposits/${bought.id}/mock-payment`, walletBuyer.token, "POST", { outcome: "Succeeded" });
  await request(`/wallets/deposits/${bought.id}/payout`, walletBuyer.token, "POST");
  assert.equal(await ethers.provider.getBalance(walletBuyer.address) - walletBefore, 250_000n * VND, "A repeat must not pay twice");
  console.log("PASS gateway deposit into a MetaMask wallet");

  const terms = await request("/orders/terms", ledgerBuyer.token);
  const newDraft = async (buyer: { token: string }, seller: { email: string }, amountVnd: bigint) => {
    const deadline = Math.max((await ethers.provider.getBlock("latest"))!.timestamp, Math.floor(Date.now() / 1000)) + 3600;
    for (let i = 0; i < 40; i++) {
      const listed = await request("/orders/arbiters", buyer.token);
      if (listed.some((row: any) => row.address.toLowerCase() === arbiter.address.toLowerCase())) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return (await request("/orders", buyer.token, "POST", { sellerEmail: seller.email, arbiter: arbiter.address, acceptedTermsVersion: terms.version,
      description: `Order ${randomUUID()}`, acceptanceCriteria: "Works", amountWei: (amountVnd * VND).toString(), deliveryDeadline: deadline, reviewWindow: 300 }, 201)).draft;
  };
  const waitState = async (id: string, state: string, token: string): Promise<any> => {
    for (let i = 0; i < 40; i++) {
      const view = await request(`/orders/${id}`, token);
      if (view.chain?.state === state && view.syncStatus === "Ready") return view;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`Timed out waiting for ${state}`);
  };
  const act = (id: string, token: string, action: string) =>
    request(`/orders/${id}/actions`, token, "POST", { action, acceptedTermsVersion: action === "accept" ? terms.version : undefined });
  const upload = (id: string, token: string) => {
    const form = new FormData(); form.append("kind", "product"); form.append("file", new Blob([new Uint8Array(zip)]), "demo.zip");
    return request(`/orders/${id}/files`, token, "POST", form);
  };

  // Ledger Buyer pays a Seller on MetaMask: the Buyer's ledger goes down and the Seller receives real ETH.
  const first = await newDraft(ledgerBuyer, walletSeller, 1_000_000n);
  await act(first.id, ledgerBuyer.token, "create");
  const created = await waitState(first.id, "Created", ledgerBuyer.token);
  const firstId = BigInt(created.chain.orderId);
  // A self-held account cannot ask the server to sign for it.
  assert.equal((await request(`/orders/${first.id}/actions`, walletSeller.token, "POST", { action: "accept", acceptedTermsVersion: terms.version }, 409)).code, "CUSTODIAL_WALLET_REQUIRED");
  await (await escrow.connect(walletSeller.signer).acceptOrder(firstId)).wait();
  await waitState(first.id, "Accepted", ledgerBuyer.token);
  await act(first.id, ledgerBuyer.token, "deposit");
  await waitState(first.id, "Funded", ledgerBuyer.token);
  assert.equal(await balance(ledgerBuyer), 2_000_000n);
  const product = await upload(first.id, walletSeller.token);
  await (await escrow.connect(walletSeller.signer).markDelivered(firstId, product.sha256)).wait();
  await waitState(first.id, "Delivered", ledgerBuyer.token);
  const sellerBefore = await ethers.provider.getBalance(walletSeller.address);
  await act(first.id, ledgerBuyer.token, "confirm");
  await waitState(first.id, "Completed", ledgerBuyer.token);
  assert.equal(await ethers.provider.getBalance(walletSeller.address) - sellerBefore, 990_000n * VND, "The Seller receives the amount less the 1% fee");
  assert.equal(await balance(ledgerBuyer), 2_000_000n);
  console.log("PASS ledger Buyer to MetaMask Seller");

  // A Buyer on MetaMask pays a ledger Seller: real ETH leaves the wallet and the Seller's ledger goes up.
  const second = await newDraft(walletBuyer, ledgerSeller, 500_000n);
  const secondCreated = await (await escrow.connect(walletBuyer.signer).createOrder(ledgerSeller.address, arbiter.address, BigInt(second.amountWei),
    second.clientReference, second.termsHash, second.deliveryDeadline, second.reviewWindow)).wait();
  assert.equal(secondCreated.status, 1);
  const view = await waitState(second.id, "Created", walletBuyer.token);
  const secondId = BigInt(view.chain.orderId);
  await act(second.id, ledgerSeller.token, "accept");
  await waitState(second.id, "Accepted", walletBuyer.token);
  await (await escrow.connect(walletBuyer.signer).deposit(secondId, { value: BigInt(second.amountWei) })).wait();
  await waitState(second.id, "Funded", walletBuyer.token);
  assert.equal((await account(walletBuyer)).entries.length, 0, "A self-held wallet has no ledger entries");
  await upload(second.id, ledgerSeller.token);
  await act(second.id, ledgerSeller.token, "deliver");
  await waitState(second.id, "Delivered", walletBuyer.token);
  await (await escrow.connect(walletBuyer.signer).confirmReceipt(secondId)).wait();
  await waitState(second.id, "Completed", walletBuyer.token);
  for (let i = 0; i < 40 && await balance(ledgerSeller) === 0n; i++) await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(await balance(ledgerSeller), 495_000n, "The ledger Seller is credited the amount less the 1% fee");
  assert.equal((await account(walletBuyer)).entries.length, 0);
  console.log("PASS MetaMask Buyer to ledger Seller");
  console.log("Mixed wallet smoke checks passed");
} finally { await connection.close(); }
