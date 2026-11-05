import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseEther, sha256 } from "ethers";
import { network } from "hardhat";

// Full custodial flow against a running API, SQL and local node. Point the API at a throwaway database:
// it creates accounts, credits balances and finally deploys a new contract to prove held funds survive it.
const base = process.env.ESCROW_API_URL ?? "http://localhost:5180";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Smoke only supports a local API");
const password = "DemoPassword123!";
const adminEmail = process.env.ESCROW_ADMIN_EMAIL ?? "custody.admin@example.test";
const adminPassword = process.env.ESCROW_ADMIN_PASSWORD ?? password;
const VND = 10_000_000_000n;
const zip = Buffer.from("UEsDBBQAAAAAAKGYRl1YeXccKgAAACoAAAAKAAAAaW5kZXguaHRtbDwhZG9jdHlwZSBodG1sPjxoMT5TdHVkZW50RXNjcm93IGRlbW88L2gxPlBLAQIUABQAAAAAAKGYRl1YeXccKgAAACoAAAAKAAAAAAAAAAAAAACAAQAAAABpbmRleC5odG1sUEsFBgAAAAABAAEAOAAAAFIAAAAAAA==", "base64");

async function request(path: string, token?: string, method = "GET", body?: unknown, expected = 200): Promise<any> {
  const multipart = body instanceof FormData;
  const response = await fetch(`${base}/api${path}`, { method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(!multipart && body ? { "Content-Type": "application/json" } : {}) },
    body: body ? multipart ? body : JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) });
  const text = await response.text();
  assert.equal(response.status, expected, `${method} ${path}: ${text}`);
  const type = response.headers.get("content-type") ?? "";
  return text && type.includes("json") ? JSON.parse(text) : text;
}

const connection = await network.create();
try {
  const { ethers, provider } = connection;
  assert.equal((await ethers.provider.getNetwork()).chainId, 31337n);

  if (process.env.SMOKE_SEED_LEGACY) {
    // Recreates accounts linked to Hardhat wallets 0-3 before custody existed, for the import check on restart.
    const signers = await ethers.getSigners();
    for (const [index, email] of [adminEmail, "legacy.1@example.test", "legacy.2@example.test", "legacy.3@example.test"].entries()) {
      const auth = await request("/auth/register", undefined, "POST", { email, fullName: `Legacy ${index}`, password, useExternalWallet: true }, 201);
      const challenge = await request("/wallets/challenges", auth.accessToken, "POST", { address: signers[index].address, chainId: 31337 });
      await request("/wallets/link", auth.accessToken, "POST", { challengeId: challenge.challengeId, signature: await signers[index].signMessage(challenge.message) });
    }
    console.log("Seeded 4 accounts on Hardhat wallets 0-3. Restart the API, then run without SMOKE_SEED_LEGACY.");
    process.exit(0);
  }

  const manifest = JSON.parse(await readFile(new URL("local/latest.json", import.meta.url), "utf8"));
  const escrowBalance = () => ethers.provider.getBalance(manifest.contractAddress);
  const admin = (await request("/auth/login", undefined, "POST", { email: adminEmail, password: adminPassword })).accessToken as string;
  const adminWallet = await request("/wallets/me", admin);
  assert.equal(adminWallet.custodial, true, "Existing Hardhat account #0 must have been imported into custody");
  assert.equal(adminWallet.address.toLowerCase(), "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "Imported account keeps its address");

  const run = randomUUID();
  async function register(role: string) {
    const auth = await request("/auth/register", undefined, "POST", { email: `custody.${run}.${role}@example.test`, fullName: `Custody ${role}`, password }, 201);
    assert.ok(!/privateKey|encrypted/i.test(JSON.stringify(auth)), "Keys must never appear in API responses");
    const wallet = await request("/wallets/me", auth.accessToken);
    assert.equal(wallet.custodial, true);
    assert.equal(wallet.chainId, 31337);
    return { token: auth.accessToken as string, address: wallet.address as string, email: `custody.${run}.${role}@example.test` };
  }
  const [buyer, seller, arbiter, outsider] = [await register("buyer"), await register("seller"), await register("arbiter"), await register("outsider")];
  assert.equal(new Set([buyer, seller, arbiter, outsider].map(actor => actor.address)).size, 4);
  assert.equal(await ethers.provider.getBalance(buyer.address), 0n, "A new wallet starts empty on chain");
  const balance = async (actor: { token: string }) => {
    const account = await request("/wallets/account", actor.token);
    return { balance: BigInt(account.balanceWei) / VND, locked: BigInt(account.lockedWei) / VND, entries: account.entries as any[] };
  };
  assert.deepEqual((await balance(buyer)).balance, 0n);
  const raw = JSON.stringify(await request("/wallets/account", buyer.token));
  assert.ok(!/privateKey|encrypted/i.test(raw));

  // A new account cannot replace its wallet with another one, or reach the admin endpoints.
  await request("/wallets/challenges", buyer.token, "POST", { address: arbiter.address, chainId: 31337 }, 409);
  await request("/admin/accounts", outsider.token, "GET", undefined, 403);
  await request("/admin/wallets/credits", outsider.token, "POST", { address: outsider.address, amountVnd: 1000, reference: randomUUID() }, 403);
  await request("/admin/wallets/verification", outsider.token, "POST", { address: outsider.address, verified: true }, 409);

  for (const actor of [buyer, seller]) await request("/admin/wallets/verification", admin, "POST", { address: actor.address, verified: true });
  // Deposit through the simulated gateway. This money then funds escrow like any other balance.
  const depositReference = randomUUID();
  const deposit = await request("/wallets/deposits", buyer.token, "POST", { amountVnd: 200_000, reference: depositReference });
  assert.equal(deposit.status, "Pending");
  assert.equal((await request("/wallets/deposits", buyer.token, "POST", { amountVnd: 200_000, reference: depositReference })).id, deposit.id, "A repeated reference must not open a second request");
  assert.equal((await balance(buyer)).balance, 0n, "An unpaid request must not add money");
  await request("/wallets/deposits", buyer.token, "POST", { amountVnd: 9_999, reference: randomUUID() }, 400);
  await request(`/wallets/deposits/${deposit.id}`, outsider.token, "GET", undefined, 404);
  await request(`/wallets/deposits/${deposit.id}/mock-payment`, outsider.token, "POST", { outcome: "Succeeded" }, 404);
  await request(`/wallets/deposits/${deposit.id}/cancel`, outsider.token, "POST", undefined, 404);
  const timestamp = Math.floor(Date.now() / 1000);
  const hook = { depositId: deposit.id, amountVnd: 200_000, status: "Succeeded", gatewayTransactionId: `SMOKE-${run}`, timestamp };
  const sign = (body: typeof hook, secret: Buffer) => createHmac("sha256", secret)
    .update([body.depositId.replaceAll("-", ""), body.amountVnd, body.status, body.gatewayTransactionId, body.timestamp].join("|")).digest("hex");
  assert.equal((await request("/payments/webhook", undefined, "POST", { ...hook, signature: "0".repeat(64) }, 401)).code, "INVALID_PAYMENT_SIGNATURE");
  assert.equal((await balance(buyer)).balance, 0n, "A forged webhook must not add money");
  const secret = process.env.SMOKE_WEBHOOK_SECRET;
  if (secret) {
    const key = Buffer.from(secret, "base64");
    // Signed, but altered after signing, then for an amount the request never asked for.
    await request("/payments/webhook", undefined, "POST", { ...hook, amountVnd: 50_000_000, signature: sign(hook, key) }, 401);
    const wrongAmount = { ...hook, amountVnd: 50_000_000 };
    assert.equal((await request("/payments/webhook", undefined, "POST", { ...wrongAmount, signature: sign(wrongAmount, key) }, 409)).code, "DEPOSIT_AMOUNT_MISMATCH");
    const signed = { ...hook, signature: sign(hook, key) };
    assert.equal((await request("/payments/webhook", undefined, "POST", signed)).status, "Succeeded");
    assert.equal((await request("/payments/webhook", undefined, "POST", signed)).status, "Succeeded");
  } else {
    assert.equal((await request(`/wallets/deposits/${deposit.id}/mock-payment`, buyer.token, "POST", { outcome: "Succeeded" })).status, "Succeeded");
    assert.equal((await request(`/wallets/deposits/${deposit.id}/mock-payment`, buyer.token, "POST", { outcome: "Succeeded" })).status, "Succeeded");
  }
  assert.equal((await balance(buyer)).balance, 200_000n, "A repeated webhook must pay once");
  assert.equal((await request(`/wallets/deposits/${deposit.id}/mock-payment`, buyer.token, "POST", { outcome: "Failed" }, 409)).code, "DEPOSIT_ALREADY_FINAL");
  assert.ok((await request("/wallets/account", buyer.token)).entries.some((entry: any) => entry.type === "GatewayDeposit"));

  const reference = randomUUID();
  const credit = { address: buyer.address, amountVnd: 4_800_000, reference, note: "Smoke credit" };
  await request("/admin/wallets/credits", admin, "POST", credit);
  await request("/admin/wallets/credits", admin, "POST", credit);
  assert.equal((await balance(buyer)).balance, 5_000_000n, "A repeated credit reference must not pay twice");
  const accounts = await request("/admin/accounts", admin);
  assert.ok(accounts.accounts.some((row: any) => row.address.toLowerCase() === buyer.address.toLowerCase() && row.balanceVnd === "5000000" && row.verifiedOnChain));

  // Partner lookup is by exact email, and never exposes the partner's full address.
  const found = await request("/orders/party-lookup", buyer.token, "POST", { email: seller.email.toUpperCase() });
  assert.equal(found.address, seller.address);
  assert.equal(found.fullName, "Custody seller");
  assert.ok(!found.maskedEmail.includes(run), "Lookup must mask the email");
  await request("/orders/party-lookup", buyer.token, "POST", { email: `missing.${run}@example.test` }, 404);
  assert.equal((await request("/orders/party-lookup", buyer.token, "POST", { email: buyer.email }, 400)).code, "INVALID_PARTIES");

  // The platform manages the Arbiter list; only the contract's default admin can change it.
  const terms = await request("/orders/terms", buyer.token);
  assert.equal(terms.hash, sha256(new TextEncoder().encode(terms.text)));
  const chainDeadline = async () => Math.max((await ethers.provider.getBlock("latest"))!.timestamp, Math.floor(Date.now() / 1000)) + 3600;
  const body = async (amountVnd: bigint, changes: Record<string, unknown> = {}) => ({ sellerEmail: seller.email, arbiter: arbiter.address, acceptedTermsVersion: terms.version,
    description: `Order ${randomUUID()}`, acceptanceCriteria: "Works", amountWei: (amountVnd * VND).toString(), deliveryDeadline: await chainDeadline(), reviewWindow: 300, ...changes });
  assert.equal((await request("/orders", buyer.token, "POST", await body(1000n), 400)).code, "ARBITER_NOT_APPROVED");
  assert.equal((await request("/admin/arbiters", outsider.token, "POST", { address: outsider.address, approved: true }, 409)).code, "CHAIN_REVERTED_AccessControlUnauthorizedAccount");
  await request("/admin/arbiters", admin, "POST", { address: `0x${"9".repeat(40)}`, approved: true }, 404);
  const listed = async (expected: boolean) => {
    for (let i = 0; i < 40; i++) {
      const rows = await request("/orders/arbiters", buyer.token);
      if (rows.some((row: any) => row.address.toLowerCase() === arbiter.address.toLowerCase()) === expected) return rows;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`Arbiter list did not reach ${expected}`);
  };
  await request("/admin/arbiters", admin, "POST", { address: arbiter.address, approved: true });
  assert.equal((await listed(true)).find((row: any) => row.address.toLowerCase() === arbiter.address.toLowerCase()).fullName, "Custody arbiter");
  assert.ok((await request("/admin/accounts", admin)).accounts.some((row: any) => row.address.toLowerCase() === arbiter.address.toLowerCase() && row.approvedArbiter));
  assert.equal((await request("/orders", buyer.token, "POST", await body(1000n, { arbiter: outsider.address }), 400)).code, "ARBITER_NOT_APPROVED");
  assert.equal((await request("/orders", buyer.token, "POST", await body(1000n, { acceptedTermsVersion: "2000-01-v0" }), 400)).code, "TERMS_NOT_ACCEPTED");

  async function draft(amountVnd: bigint) {
    const view = await request("/orders", buyer.token, "POST", await body(amountVnd), 201);
    assert.ok(view.draft.buyerAcceptedTermsAt, "The Buyer's consent must be recorded");
    assert.equal(view.draft.standardTermsVersion, terms.version);
    assert.equal(JSON.parse(view.draft.termsJson).standardTermsHash, terms.hash);
    return view.draft.id as string;
  }
  async function waitState(id: string, state: string, token = buyer.token): Promise<any> {
    for (let i = 0; i < 40; i++) {
      const view = await request(`/orders/${id}`, token);
      if (view.chain?.state === state && view.syncStatus === "Ready") return view;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`Timed out waiting for ${state}`);
  }
  const act = (id: string, token: string, action: string, expected = 200, sellerShareBps?: number) =>
    request(`/orders/${id}/actions`, token, "POST", { action, sellerShareBps, acceptedTermsVersion: action === "accept" ? terms.version : undefined }, expected);
  async function accepted(amountVnd: bigint) {
    const id = await draft(amountVnd);
    await act(id, buyer.token, "create");
    await waitState(id, "Created");
    await act(id, seller.token, "accept");
    await waitState(id, "Accepted");
    return id;
  }
  async function funded(amountVnd: bigint) {
    const id = await accepted(amountVnd);
    await act(id, buyer.token, "deposit");
    await waitState(id, "Funded");
    return id;
  }
  async function upload(id: string, token: string) {
    const form = new FormData(); form.append("kind", "product"); form.append("file", new Blob([new Uint8Array(zip)]), "demo.zip");
    return request(`/orders/${id}/files`, token, "POST", form);
  }

  // Seller acceptance: nothing can be locked before it, and only the Seller can give it, with explicit consent.
  const pending = await draft(1_000_000n);
  await act(pending, buyer.token, "create");
  await waitState(pending, "Created");
  assert.equal((await act(pending, buyer.token, "deposit", 409)).code, "SELLER_NOT_ACCEPTED");
  assert.equal((await balance(buyer)).locked, 0n);
  assert.equal((await request(`/orders/${pending}/actions`, seller.token, "POST", { action: "accept" }, 400)).code, "TERMS_NOT_ACCEPTED");
  assert.equal((await request(`/orders/${pending}/actions`, seller.token, "POST", { action: "accept", acceptedTermsVersion: "2000-01-v0" }, 400)).code, "TERMS_NOT_ACCEPTED");
  await act(pending, buyer.token, "accept", 403);
  await act(pending, arbiter.token, "accept", 403);
  await act(pending, arbiter.token, "cancel", 409);
  await act(pending, outsider.token, "accept", 404);
  // Declining costs nothing and is final.
  await act(pending, seller.token, "cancel");
  const declined = await waitState(pending, "Cancelled");
  assert.equal(declined.parties.arbiter.fullName, "Custody arbiter");
  await act(pending, seller.token, "accept", 409);
  await act(pending, buyer.token, "deposit", 409);
  assert.equal((await balance(buyer)).balance, 5_000_000n);
  const walkaway = await accepted(1_000_000n);
  await act(walkaway, buyer.token, "cancel");
  await waitState(walkaway, "Cancelled");
  console.log("PASS email lookup, Arbiter list, consent, Seller acceptance and cancellation");

  // A removed Arbiter blocks funding, and can rule again only if re-approved.
  const orphan = await accepted(1_000_000n);
  await request("/admin/arbiters", admin, "POST", { address: arbiter.address, approved: false });
  await listed(false);
  const blocked = await act(orphan, buyer.token, "deposit", 409);
  assert.equal(blocked.code, "CHAIN_REVERTED_ArbiterNotApproved");
  assert.equal((await balance(buyer)).balance, 5_000_000n, "A rejected deposit must release its hold");
  await request("/admin/arbiters", admin, "POST", { address: arbiter.address, approved: true });
  await listed(true);
  await act(orphan, buyer.token, "cancel");
  await waitState(orphan, "Cancelled");

  // Insufficient balance: rejected before anything reaches the chain, and no funds move.
  const tooBig = await accepted(6_000_000n);
  const nonceBefore = await ethers.provider.getTransactionCount(buyer.address);
  const rejected = await act(tooBig, buyer.token, "deposit", 409);
  assert.equal(rejected.code, "INSUFFICIENT_BALANCE");
  assert.match(rejected.message, /5\.000\.000 VND/);
  assert.equal(await ethers.provider.getTransactionCount(buyer.address), nonceBefore);
  assert.equal((await balance(buyer)).balance, 5_000_000n);

  // Happy path: hold, delivery, confirmation, payout minus the 1% fee.
  const happy = await funded(1_000_000n);
  let state = await balance(buyer);
  assert.deepEqual([state.balance, state.locked], [4_000_000n, 1_000_000n]);
  assert.equal(await escrowBalance(), parseEther("0.01"));
  await act(happy, buyer.token, "deposit", 409);
  assert.equal((await balance(buyer)).balance, 4_000_000n, "A second deposit must not debit again");
  await act(happy, outsider.token, "confirm", 404);
  const product = await upload(happy, seller.token);
  assert.equal(product.sha256, sha256(zip));
  const download = `/orders/${happy}/files/${product.id}`;
  const premature = await request(download, buyer.token, "GET", undefined, 403);
  assert.equal(premature.code, "PRODUCT_NOT_DELIVERED");
  await request(download, arbiter.token, "GET", undefined, 403);
  await request(download, seller.token);
  await act(happy, seller.token, "deliver");
  await waitState(happy, "Delivered");
  await request(download, buyer.token);
  await act(happy, seller.token, "confirm", 409);
  await act(happy, buyer.token, "confirm");
  await waitState(happy, "Completed");
  await new Promise(resolve => setTimeout(resolve, 500));
  state = await balance(seller);
  assert.equal(state.balance, 990_000n, "Seller receives the amount minus 1%");
  assert.equal(state.entries[0].type, "EscrowPayout");
  assert.match(state.entries[0].transactionHash, /^0x[0-9a-f]{64}$/);
  state = await balance(buyer);
  assert.deepEqual([state.balance, state.locked], [4_000_000n, 0n]);

  // Dispute: the Arbiter's split reaches both ledgers.
  const disputed = await funded(1_000_000n);
  await act(disputed, seller.token, "dispute");
  await waitState(disputed, "Disputed");
  await act(disputed, buyer.token, "resolve", 409, 7000);
  await act(disputed, arbiter.token, "resolve", 400, 10001);
  await act(disputed, arbiter.token, "resolve", 200, 7000);
  await waitState(disputed, "Resolved");
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal((await balance(buyer)).balance, 3_300_000n);
  assert.equal((await balance(seller)).balance, 990_000n + 693_000n);

  // Dispute timeout: unavailable early; after 30 days either party can force the even split.
  const absent = await funded(1_000_000n);
  await act(absent, buyer.token, "dispute");
  await waitState(absent, "Disputed");
  const early = await act(absent, seller.token, "timeout", 409);
  assert.equal(early.code, "CHAIN_REVERTED_DeadlineNotPassed");
  const refundable = await funded(1_000_000n);
  assert.equal((await balance(buyer)).balance, 1_300_000n);
  await provider.request({ method: "evm_increaseTime", params: [30 * 24 * 3600 + 5] });
  await provider.request({ method: "evm_mine", params: [] });
  await act(absent, seller.token, "timeout");
  await waitState(absent, "Resolved");
  await act(refundable, buyer.token, "refund");
  await waitState(refundable, "Refunded");
  await new Promise(resolve => setTimeout(resolve, 500));
  // 1.3M + 500k (half of the disputed order) + 1M (expired order).
  assert.equal((await balance(buyer)).balance, 2_800_000n);
  assert.equal((await balance(seller)).balance, 990_000n + 693_000n + 495_000n);
  assert.equal(await escrowBalance(), 0n, "Everything settled, so the contract holds nothing");

  // Replacing the chain: an unsettled hold returns to the buyer, a settled order does not pay again.
  const stranded = await accepted(1_000_000n);
  await act(stranded, buyer.token, "deposit");
  await waitState(stranded, "Funded");
  assert.equal((await balance(buyer)).balance, 1_800_000n);
  execFileSync("npm", ["run", "-s", "deploy:local"], { cwd: new URL("..", import.meta.url), stdio: "ignore", shell: true });
  const next = JSON.parse(await readFile(new URL("local/latest.json", import.meta.url), "utf8"));
  assert.notEqual(next.deploymentId, manifest.deploymentId);
  for (let i = 0; i < 40 && (await balance(buyer)).balance !== 2_800_000n; i++) await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal((await balance(buyer)).balance, 2_800_000n, "The hold on the replaced deployment must return");
  assert.equal((await balance(seller)).balance, 990_000n + 693_000n + 495_000n);
  const archived = await act(stranded, buyer.token, "refund", 409);
  assert.equal(archived.code, "CHAIN_NOT_READY");

  console.log("Custodial smoke checks passed");
} finally {
  await connection.close();
}
