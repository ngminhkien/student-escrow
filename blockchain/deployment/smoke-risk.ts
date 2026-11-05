import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { network } from "hardhat";

// Risk scoring and analytics against a running API, SQL and local node. Point the API at a throwaway database,
// with Hardhat account #0 already imported into custody (see smoke-custodial.ts, SMOKE_SEED_LEGACY).
const base = process.env.ESCROW_API_URL ?? "http://localhost:5180";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Smoke only supports a local API");
const password = "DemoPassword123!";
const adminEmail = process.env.ESCROW_ADMIN_EMAIL ?? "custody.admin@example.test";
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
  const admin = (await request("/auth/login", undefined, "POST", { email: adminEmail, password })).accessToken as string;
  const run = randomUUID();
  async function register(role: string) {
    const email = `risk.${run}.${role}@example.test`;
    const auth = await request("/auth/register", undefined, "POST", { email, fullName: `Risk ${role}`, password }, 201);
    return { token: auth.accessToken as string, address: (await request("/wallets/me", auth.accessToken)).address as string, email };
  }
  const [buyer, seller, arbiter, outsider] = [await register("buyer"), await register("seller"), await register("arbiter"), await register("outsider")];
  for (const actor of [buyer, seller]) await request("/admin/wallets/verification", admin, "POST", { address: actor.address, verified: true });
  await request("/admin/wallets/credits", admin, "POST", { address: buyer.address, amountVnd: 90_000_000, reference: randomUUID(), note: "Risk smoke" });
  await request("/admin/arbiters", admin, "POST", { address: arbiter.address, approved: true });
  for (let i = 0; ; i++) {
    if ((await request("/orders/arbiters", buyer.token)).some((row: any) => row.address.toLowerCase() === arbiter.address.toLowerCase())) break;
    assert.ok(i < 40, "Arbiter never reached the list");
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const terms = await request("/orders/terms", buyer.token);
  const act = (id: string, token: string, action: string, sellerShareBps?: number) =>
    request(`/orders/${id}/actions`, token, "POST", { action, sellerShareBps, acceptedTermsVersion: action === "accept" ? terms.version : undefined });
  async function reach(id: string, state: string): Promise<any> {
    for (let i = 0; i < 40; i++) {
      const view = await request(`/orders/${id}`, buyer.token);
      if (view.chain?.state === state && view.syncStatus === "Ready") return view;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`Timed out waiting for ${state}`);
  }
  async function draft(amountVnd: bigint, category?: string) {
    const deadline = Math.max((await ethers.provider.getBlock("latest"))!.timestamp, Math.floor(Date.now() / 1000)) + 3600;
    const view = await request("/orders", buyer.token, "POST", { sellerEmail: seller.email, arbiter: arbiter.address, acceptedTermsVersion: terms.version, category,
      description: `Risk ${randomUUID()}`, acceptanceCriteria: "Works", amountWei: (amountVnd * VND).toString(), deliveryDeadline: deadline, reviewWindow: 300 }, 201);
    return view.draft.id as string;
  }
  async function funded(amountVnd: bigint, category?: string) {
    const id = await draft(amountVnd, category);
    await act(id, buyer.token, "create"); await reach(id, "Created");
    await act(id, seller.token, "accept"); await reach(id, "Accepted");
    await act(id, buyer.token, "deposit"); await reach(id, "Funded");
    return id;
  }
  async function resolved(sellerShareBps: number, category?: string) {
    const id = await funded(1_000_000n, category);
    await act(id, buyer.token, "dispute"); await reach(id, "Disputed");
    await act(id, arbiter.token, "resolve", sellerShareBps); await reach(id, "Resolved");
  }
  async function completed(category?: string) {
    const id = await funded(1_000_000n, category);
    const form = new FormData();
    form.append("kind", "product");
    form.append("file", new File([zip], "product.zip", { type: "application/zip" }));
    await request(`/orders/${id}/files`, seller.token, "POST", form);
    await act(id, seller.token, "deliver"); await reach(id, "Delivered");
    await act(id, buyer.token, "confirm"); await reach(id, "Completed");
  }

  // A brand-new Seller: the score must say so instead of treating no history as safe.
  const first = await draft(1_000_000n, "design");
  const fresh = await request(`/orders/${first}/risk`, admin);
  assert.ok(Number.isInteger(fresh.score) && fresh.score >= 0 && fresh.score <= 100);
  assert.equal(fresh.scoringSource, "ml", "The API must have loaded the trained model");
  assert.equal(fresh.modelVersion, "logistic-v1");
  assert.equal(fresh.dataSource, "synthetic");
  assert.equal(fresh.reasonSource, "rule-based");
  assert.equal(fresh.featureVersion, "v1");
  assert.ok(fresh.reasons.some((reason: string) => reason.includes("chưa có lịch sử")), JSON.stringify(fresh.reasons));

  // Admin only: the order's own parties cannot read it, and the answer does not reveal whether an order exists.
  for (const user of [buyer, seller, arbiter, outsider]) {
    await request(`/orders/${first}/risk`, user.token, "GET", undefined, 403);
    await request(`/orders/${randomUUID()}/risk`, user.token, "GET", undefined, 403);
  }
  await request(`/orders/${first}/risk`, undefined, "GET", undefined, 401);
  assert.equal((await request(`/orders/${randomUUID()}/risk`, admin, "GET", undefined, 404)).code, "ORDER_NOT_FOUND");

  // An off-list category is rejected, and the category stays out of the hashed terms.
  const refused = await request("/orders", buyer.token, "POST", { sellerEmail: seller.email, arbiter: arbiter.address, acceptedTermsVersion: terms.version, category: "weapons",
    description: "x", acceptanceCriteria: "x", amountWei: (1000n * VND).toString(), deliveryDeadline: Math.floor(Date.now() / 1000) + 7200, reviewWindow: 300 }, 400);
  assert.equal(refused.code, "INVALID_CATEGORY");
  const labelled = await request(`/orders/${first}`, buyer.token);
  assert.equal(labelled.draft.category, "design");
  assert.ok(!labelled.draft.termsJson.includes("category"));

  // Scoring reads, and only reads.
  await request(`/orders/${first}/risk`, admin);
  assert.deepEqual(await request(`/orders/${first}`, buyer.token), labelled);

  await completed("programming");
  await resolved(7000, "documents");
  for (let i = 0; i < 3; i++) await resolved(0);
  await funded(1_000_000n, "other");

  // Six funded orders, four disputed and three refunded in full, then a much larger order.
  const large = await draft(20_000_000n);
  const flagged = await request(`/orders/${large}/risk`, admin);
  const joined = flagged.reasons.join(" | ");
  assert.ok(joined.includes("tranh chấp"), joined);
  assert.ok(joined.includes("lần trung bình"), joined);
  assert.ok(flagged.reasons.length <= 3);
  assert.ok(flagged.score > fresh.score, `${flagged.score} must exceed ${fresh.score}`);

  await request("/analytics/summary", outsider.token, "GET", undefined, 403);
  await request("/analytics/summary", undefined, "GET", undefined, 401);
  await request("/analytics/summary?source=other", admin, "GET", undefined, 400);
  await request(`/analytics/summary?deploymentId=${randomUUID()}`, admin, "GET", undefined, 404);

  const chain = await request("/analytics/summary?source=chain", admin);
  assert.equal(chain.source, "chain");
  assert.equal(chain.chainId, 31337);
  assert.ok(chain.deployments.some((item: any) => item.id === chain.deploymentId && item.active));
  // Other runs on this deployment may have added orders, so only this run's minimum is certain.
  assert.ok(chain.fundedOrderCount >= 6);
  assert.ok(chain.blockchainTransactionCount > chain.fundedOrderCount, "Orders must not be counted as transactions");
  assert.ok(chain.disputedCount >= 4);
  assert.ok(chain.fullRefundCount >= 3);
  assert.ok(chain.completedCount >= 1);
  assert.equal(BigInt(chain.totalEscrowVolumeWei) / BigInt(chain.fundedOrderCount), BigInt(chain.averageFundedWei));
  const risk = chain.riskDistribution;
  assert.equal(risk.low + risk.medium + risk.high + risk.unavailable, chain.fundedOrderCount);
  assert.equal(risk.scoringSource, "ml");
  assert.ok(chain.topCategories.some((item: any) => item.category === "uncategorized"), "An order without a category must stay visible");
  assert.equal(chain.topCategories.reduce((total: number, item: any) => total + item.count, 0), chain.fundedOrderCount);

  const synthetic = await request("/analytics/summary?source=synthetic", admin);
  assert.equal(synthetic.source, "synthetic");
  assert.equal(synthetic.chainId, null);
  assert.equal(synthetic.deploymentId, null);
  assert.ok(synthetic.fundedOrderCount >= 200);
  // Fetching the synthetic set must not change the chain figures.
  const again = await request("/analytics/summary?source=chain", admin);
  assert.equal(again.fundedOrderCount, chain.fundedOrderCount);
  assert.equal(again.totalEscrowVolumeWei, chain.totalEscrowVolumeWei);

  console.log(JSON.stringify({ fresh: { score: fresh.score, level: fresh.level, reasons: fresh.reasons }, flagged: { score: flagged.score, level: flagged.level, reasons: flagged.reasons },
    chain: { funded: chain.fundedOrderCount, transactions: chain.blockchainTransactionCount, completion: chain.completionRate, dispute: chain.disputeRate, refund: chain.fullRefundRate, risk, categories: chain.topCategories },
    synthetic: { funded: synthetic.fundedOrderCount, transactions: synthetic.blockchainTransactionCount, completion: synthetic.completionRate, dispute: synthetic.disputeRate, refund: synthetic.fullRefundRate, risk: synthetic.riskDistribution } }, null, 2));
  console.log("Risk and analytics smoke checks passed");
} finally {
  await connection.close();
}
