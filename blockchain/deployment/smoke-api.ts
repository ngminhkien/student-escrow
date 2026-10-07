import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Wallet, parseEther, sha256, toUtf8Bytes, NonceManager } from "ethers";
import { network } from "hardhat";

const base = process.env.ESCROW_API_URL ?? "http://localhost:5180";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Smoke only supports a local API");
const manifest = JSON.parse(await readFile(new URL("local/latest.json", import.meta.url), "utf8"));
const connection = await network.create();
try {
  const { ethers, provider } = connection;
  assert.equal(connection.networkName, "localhost");
  assert.equal((await ethers.provider.getNetwork()).chainId, 31337n);
  const [admin] = await ethers.getSigners();
  const escrow: any = await ethers.getContractAt("Escrow", manifest.contractAddress, admin);
  const run = randomUUID();
  async function request(path: string, token?: string, method = "GET", body?: unknown, expected = 200): Promise<any> {
    const multipart = body instanceof FormData;
    const response = await fetch(`${base}${path}`, { method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(!multipart && body ? { "Content-Type": "application/json" } : {}) },
      body: body ? multipart ? body : JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
    const text = await response.text();
    assert.equal(response.status, expected, `${method} ${path}: ${text}`);
    return text ? JSON.parse(text) : undefined;
  }
  await request("/api/health/ready");
  const health = await request("/api/health/blockchain");
  assert.equal(health.deploymentId, manifest.deploymentId);
  assert.equal(health.confirmations, 0, "This local reorg smoke requires Blockchain:Confirmations=0");
  const actors = [];
  for (const role of ["buyer", "seller", "arbiter", "outsider"]) {
    const wallet = Wallet.createRandom().connect(ethers.provider);
    const auth = await request("/api/auth/register", undefined, "POST", {
      email: `orders.${run}.${role}@example.test`, fullName: `Escrow ${role}`, password: "DemoPassword123!" }, 201);
    const challenge = await request("/api/wallets/challenges", auth.accessToken, "POST", { address: wallet.address, chainId: 31337 });
    await request("/api/wallets/link", auth.accessToken, "POST", { challengeId: challenge.challengeId, signature: await wallet.signMessage(challenge.message) });
    actors.push({ wallet, signer: new NonceManager(wallet), token: auth.accessToken });
  }
  const [buyer, seller, arbiter, outsider] = actors;
  for (const actor of [buyer, seller, arbiter]) await (await admin.sendTransaction({ to: actor.wallet.address, value: parseEther("1") })).wait();
  for (const actor of [buyer, seller]) await (await escrow.setWalletVerified(actor.wallet.address, true)).wait();
  const amount = parseEther("0.01");
  const now = (await ethers.provider.getBlock("latest"))!.timestamp;
  const draftView = await request("/api/orders", buyer.token, "POST", { seller: seller.wallet.address, arbiter: arbiter.wallet.address,
    description: "Landing page demo", acceptanceCriteria: "Works at 375px and 1440px", amountWei: amount.toString(),
    deliveryDeadline: Math.max(now, Math.floor(Date.now() / 1000)) + 3600, reviewWindow: 300 }, 201);
  const draft = draftView.draft;
  const path = `/api/orders/${draft.id}`;
  assert.equal(sha256(toUtf8Bytes(draft.termsJson)), draft.termsHash);
  assert.equal(draftView.chain, null);
  await request(path, outsider.token, "GET", undefined, 404);
  await request(path, undefined, "GET", undefined, 401);
  await (await escrow.connect(buyer.signer).createOrder(seller.wallet.address, arbiter.wallet.address, amount,
    draft.clientReference, draft.termsHash, draft.deliveryDeadline, draft.reviewWindow)).wait();
  async function waitState(state: string, orderPath = path): Promise<any> {
    for (let i = 0; i < 40; i++) {
      const view = await request(orderPath, buyer.token);
      if (view.chain?.state === state && view.syncStatus === "Ready") return view;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error(`Timed out waiting for ${state}`);
  }
  const created = await waitState("Created");
  assert.equal(created.termsMatch, true);
  const orderId = created.chain.orderId;
  await (await escrow.connect(buyer.signer).deposit(orderId, { value: amount })).wait();
  await waitState("Funded");
  // Fixture is a real, nonempty ZIP containing index.html. No ZIP execution or extraction.
  const zip = Buffer.from("UEsDBBQAAAAAAKGYRl1YeXccKgAAACoAAAAKAAAAaW5kZXguaHRtbDwhZG9jdHlwZSBodG1sPjxoMT5TdHVkZW50RXNjcm93IGRlbW88L2gxPlBLAQIUABQAAAAAAKGYRl1YeXccKgAAACoAAAAKAAAAAAAAAAAAAACAAQAAAABpbmRleC5odG1sUEsFBgAAAAABAAEAOAAAAFIAAAAAAA==", "base64");
  async function upload(token: string, kind: string, name: string, bytes: Uint8Array, expected = 200) {
    const form = new FormData(); form.append("kind", kind); form.append("file", new Blob([new Uint8Array(bytes)]), name);
    return request(`${path}/files`, token, "POST", form, expected);
  }
  await upload(buyer.token, "product", "demo.zip", zip, 403);
  await upload(outsider.token, "product", "demo.zip", zip, 404);
  await upload(seller.token, "product", "fake.zip", toUtf8Bytes("not zip"), 400);
  await upload(seller.token, "product", "empty.zip", new Uint8Array(), 400);
  const product = await upload(seller.token, "product", "demo.zip", zip);
  assert.equal(product.sha256, sha256(zip));
  await upload(seller.token, "product", "replace.zip", zip, 409);
  for (const actor of [buyer, seller, arbiter]) {
    const response = await fetch(`${base}${path}/files/${product.id}`, { headers: { Authorization: `Bearer ${actor.token}` } });
    assert.equal(response.status, 200); assert.match(response.headers.get("content-disposition")!, /^attachment/);
    assert.equal(sha256(new Uint8Array(await response.arrayBuffer())), product.sha256);
  }
  await request(`${path}/files/${product.id}`, outsider.token, "GET", undefined, 404);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII=", "base64");
  await upload(buyer.token, "evidence", "oversize.png", new Uint8Array(5_000_001), 413);
  for (let i = 0; i < 4; i++) await upload(buyer.token, "evidence", `proof-${i}.png`, png);
  // Two contenders for the last evidence slot: exactly one must succeed.
  const contenders = await Promise.allSettled([upload(buyer.token, "evidence", "last-a.png", png), upload(seller.token, "evidence", "last-b.png", png)]);
  assert.equal(contenders.filter(r => r.status === "fulfilled").length, 1);
  const rejected = contenders.find(r => r.status === "rejected") as PromiseRejectedResult;
  assert.match(String(rejected.reason), /FILE_QUOTA/);
  console.log("PASS draft/hash, file content, participant permissions and concurrent quota");
  const snapshot = await provider.request({ method: "evm_snapshot", params: [] });
  await (await escrow.connect(seller.signer).markDelivered(orderId, product.sha256)).wait();
  assert.equal((await waitState("Delivered")).deliveryFileMatchesChain, true);
  await (await escrow.connect(buyer.signer).confirmReceipt(orderId)).wait();
  const complete = await waitState("Completed");
  assert.equal(complete.chain.sellerNetWei, "9900000000000000");
  assert.equal(complete.chain.platformFeeWei, "100000000000000");
  const history = await request(`${path}/events`, buyer.token);
  assert.deepEqual(history.map((e: any) => e.name), ["OrderCreated", "Deposited", "Delivered", "Released"]);
  await new Promise(resolve => setTimeout(resolve, 3000));
  assert.equal((await request(`${path}/events`, buyer.token)).length, 4);
  console.log("PASS API → contract → worker → SQL → API, Completed and event dedup");
  assert.equal(await provider.request({ method: "evm_revert", params: [snapshot] }), true);
  const rolledBack = await waitState("Funded");
  assert.equal(rolledBack.chain.deliveryHash, null);
  assert.equal(rolledBack.deliveryFileMatchesChain, false);
  assert.equal((await request(`${path}/events`, buyer.token)).length, 2);
  buyer.signer.reset(); seller.signer.reset();
  await provider.request({ method: "evm_setNextBlockTimestamp", params: [draft.deliveryDeadline + 1] });
  await (await escrow.connect(buyer.signer).refundIfExpired(orderId)).wait();
  const refunded = await waitState("Refunded");
  assert.equal(refunded.chain.buyerRefundWei, amount.toString());
  assert.deepEqual((await request(`${path}/events`, buyer.token)).map((e: any) => e.name), ["OrderCreated", "Deposited", "Refunded"]);
  await upload(seller.token, "evidence", "late.png", png, 409);
  console.log("PASS local reorg removes orphan events, rebuilds state and indexes replacement refund");
  const disputeDraft = (await request("/api/orders", buyer.token, "POST", {
    seller: seller.wallet.address, arbiter: arbiter.wallet.address, description: "Dispute demo", acceptanceCriteria: "Agreed scope",
    amountWei: amount.toString(), deliveryDeadline: (await ethers.provider.getBlock("latest"))!.timestamp + 3600, reviewWindow: 300 }, 201)).draft;
  const disputePath = `/api/orders/${disputeDraft.id}`;
  await (await escrow.connect(buyer.signer).createOrder(seller.wallet.address, arbiter.wallet.address, amount,
    disputeDraft.clientReference, disputeDraft.termsHash, disputeDraft.deliveryDeadline, disputeDraft.reviewWindow)).wait();
  const disputeId = (await waitState("Created", disputePath)).chain.orderId;
  await (await escrow.connect(buyer.signer).deposit(disputeId, { value: amount })).wait();
  await (await escrow.connect(buyer.signer).raiseDispute(disputeId)).wait();
  await waitState("Disputed", disputePath);
  await (await escrow.connect(arbiter.signer).resolveDispute(disputeId, 7000)).wait();
  const resolved = await waitState("Resolved", disputePath);
  assert.equal(resolved.chain.buyerRefundWei, "3000000000000000");
  assert.equal(resolved.chain.sellerNetWei, "6930000000000000");
  assert.equal(resolved.chain.platformFeeWei, "70000000000000");
  const mismatchDraft = (await request("/api/orders", buyer.token, "POST", {
    seller: seller.wallet.address, arbiter: arbiter.wallet.address, description: "Mismatch demo", acceptanceCriteria: "Agreed scope",
    amountWei: amount.toString(), deliveryDeadline: (await ethers.provider.getBlock("latest"))!.timestamp + 3600, reviewWindow: 300 }, 201)).draft;
  await (await escrow.connect(buyer.signer).createOrder(seller.wallet.address, arbiter.wallet.address, amount + 1n,
    mismatchDraft.clientReference, mismatchDraft.termsHash, mismatchDraft.deliveryDeadline, mismatchDraft.reviewWindow)).wait();
  const mismatch = await waitState("Created", `/api/orders/${mismatchDraft.id}`);
  assert.equal(mismatch.termsMatch, false);
  const mismatchForm = new FormData(); mismatchForm.append("kind", "product"); mismatchForm.append("file", new Blob([zip]), "demo.zip");
  await request(`/api/orders/${mismatchDraft.id}/files`, seller.token, "POST", mismatchForm, 409);
  console.log("PASS disputed/resolved 70:30 projection and rejection of mismatched on-chain terms");
  await writeFile(new URL("local/api-smoke-latest.json", import.meta.url), JSON.stringify({ deploymentId: manifest.deploymentId,
    draftId: draft.id, disputeDraftId: disputeDraft.id, buyerEmail: `orders.${run}.buyer@example.test`, productHash: product.sha256 }, null, 2));
  console.log(`Order/API smoke checks passed. Draft ${draft.id}; deployment ${manifest.deploymentId}. SQL data retained.`);
} finally { await connection.close(); }
