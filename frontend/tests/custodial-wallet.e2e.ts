import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { parseEther, sha256, toUtf8Bytes } from "ethers";

const account = "0x1111111111111111111111111111111111111111";
const seller = "0x2222222222222222222222222222222222222222";
const network = { status: "Ready", deploymentId: "custody-test", chainId: "31337", contractAddress: "0x4444444444444444444444444444444444444444", deploymentBlock: 1, deploymentBlockHash: "0x" + "ab".repeat(32), lastIndexedBlock: 2, checkedAt: "2099-01-01T00:00:00Z" };
const draft = { id: "00000000-0000-0000-0000-000000000001", deploymentId: network.deploymentId, buyer: account, seller, arbiter: "0x3333333333333333333333333333333333333333", amountWei: parseEther("0.01").toString(), description: "Landing page", acceptanceCriteria: "Test", deliveryDeadline: 2000000000, reviewWindow: 300, clientReference: "0x" + "11".repeat(32), termsJson: "", termsHash: "", standardTermsVersion: "v1", createdAt: "2026-01-01T00:00:00Z" };
draft.termsJson = JSON.stringify({ version: 2, standardTermsVersion: "v1", standardTermsHash: "0x" + "cd".repeat(32), chainId: 31337, contract: network.contractAddress, deploymentId: draft.deploymentId, buyer: draft.buyer, seller: draft.seller, arbiter: draft.arbiter, amountWei: draft.amountWei, description: draft.description, acceptanceCriteria: draft.acceptanceCriteria, deliveryDeadline: draft.deliveryDeadline, reviewWindow: draft.reviewWindow, clientReference: draft.clientReference, feeBps: 100 });
draft.termsHash = sha256(toUtf8Bytes(draft.termsJson));
const chain = (state: string, deliveryHash: string | null = null) => ({ orderId: "1", state, deliveryHash, reviewDeadline: 2000000300, buyerRefundWei: "0", sellerNetWei: "0", platformFeeWei: "0" });
const accountView = { custodial: true, address: account, balanceWei: parseEther("0.5").toString(), balanceVnd: "50000000", lockedWei: "0", lockedVnd: "0", vndPerEth: 100000000,
  entries: [{ id: "e1", type: "AdminCredit", amountWei: parseEther("0.5").toString(), amountVnd: "50000000", balanceAfterWei: parseEther("0.5").toString(), orderId: null, transactionHash: null, note: null, createdAt: "2026-01-01T00:00:00Z" }] };

async function fixture(page: Page, options: { state?: string; deliveryHash?: string | null; files?: unknown[]; failAction?: string; email?: string } = {}) {
  const walletCalls: string[] = [];
  const actions: unknown[] = [];
  const credits: unknown[] = [];
  const verifications: unknown[] = [];
  await page.exposeFunction("__walletCalled", (method: string) => { walletCalls.push(method); });
  await page.addInitScript(({ email }) => {
    sessionStorage.setItem("escrow.session", JSON.stringify({ accessToken: "custody", expiresAt: "2099-01-01T00:00:00Z", user: { id: "custody", fullName: "Custody test", email } }));
    // Any request reaching MetaMask would be a failure for a custodial account.
    (window as any).ethereum = { isMetaMask: true, request: async ({ method }: { method: string }) => { await (window as any).__walletCalled(method); throw new Error("MetaMask must not be used"); } };
  }, { email: options.email ?? "buyer@example.test" });
  const view = { draft, chain: options.state ? chain(options.state, options.deliveryHash ?? null) : null, termsMatch: !!options.state, syncStatus: "Ready", files: options.files ?? [], deliveryFileMatchesChain: !!options.deliveryHash, lastIndexedBlock: 2, checkedAt: "2099-01-01T00:00:00Z" };
  await page.route("**/rpc", async route => {
    const body = route.request().postDataJSON();
    const answer = (item: { id: number; method: string }) => ({ jsonrpc: "2.0", id: item.id, result:
      item.method === "eth_chainId" ? "0x7a69" : item.method === "eth_call" ? "0x" + "0".repeat(63) + "1"
      : item.method === "eth_getBlockByNumber" ? { number: "0x2", hash: network.deploymentBlockHash, parentHash: network.deploymentBlockHash, timestamp: "0x6553f100", nonce: "0x0000000000000000", difficulty: "0x0", gasLimit: "0x1c9c380", gasUsed: "0x0", miner: account, extraData: "0x", transactions: [], baseFeePerGas: "0x1" }
      : item.method === "eth_blockNumber" ? "0x2" : "0x0" });
    await route.fulfill({ json: Array.isArray(body) ? body.map(answer) : answer(body) });
  });
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith("/actions")) {
      actions.push(route.request().postDataJSON());
      if (options.failAction) return route.fulfill({ status: 409, json: { code: "INSUFFICIENT_BALANCE", message: options.failAction, traceId: "t" } });
      return route.fulfill({ json: { transactionHash: "0x" + "12".repeat(32) } });
    }
    if (path.endsWith("/admin/wallets/credits")) { credits.push(route.request().postDataJSON()); return route.fulfill({ json: accountView }); }
    if (path.endsWith("/admin/wallets/verification")) { verifications.push(route.request().postDataJSON()); return route.fulfill({ json: { transactionHash: "0x" + "12".repeat(32) } }); }
    if (path.endsWith("/admin/accounts")) return route.fulfill({ json: { ledgerTotalWei: parseEther("0.5").toString(), ledgerTotalVnd: "50000000", treasuryWei: parseEther("9000").toString(), contractWei: "0", accounts: [
      { userId: "u1", email: "buyer@example.test", fullName: "Buyer Test", address: seller, custodial: true, balanceWei: parseEther("0.5").toString(), balanceVnd: "50000000", chainBalanceWei: "0", kycStatus: "VERIFIED", verifiedOnChain: false, approvedArbiter: false },
      { userId: "u2", email: "metamask@example.test", fullName: "MetaMask User", address: "0x3333333333333333333333333333333333333333", custodial: false, balanceWei: "0", balanceVnd: "0", chainBalanceWei: "0", kycStatus: "NOT_SUBMITTED", verifiedOnChain: true, approvedArbiter: false }] } });
    return route.fulfill({ json: path.endsWith("/health/blockchain") ? network
      : path.endsWith("/wallets/me") ? { linked: true, address: account, chainId: 31337, custodial: true }
      : path.endsWith("/wallets/account") ? accountView
      : path.endsWith("/wallets/deposits") ? []
      : path.endsWith("/kyc/me") ? { status: "VERIFIED", isMock: true, reasonCode: null, maskedStudentNumber: "DEMO-***456" }
      : path.endsWith("/orders") ? [view] : path.endsWith("/events") ? [] : view });
  });
  return { walletCalls, actions, credits, verifications };
}

test("custodial account sees its VND balance and never touches MetaMask", async ({ page }) => {
  const { walletCalls } = await fixture(page);
  await page.goto("/");
  await expect(page.getByTestId("header-balance")).toHaveText("50.000.000 ₫");
  await expect(page.getByRole("button", { name: "Đồng bộ ví" })).toHaveCount(0);
  await expect(page.locator("#wallet-access-warning")).toHaveCount(0);
  await expect(page.locator(".wallet-action-gate").first()).toBeEnabled();
  await page.getByRole("button", { name: "Tài khoản & ví" }).click();
  await expect(page.getByTestId("ledger-balance")).toContainText("50.000.000 ₫");
  await expect(page.getByLabel("Lịch sử số dư").getByText("Nạp tiền")).toBeVisible();
  await page.waitForTimeout(300);
  expect(walletCalls.filter(method => method !== "eth_accounts" && method !== "eth_chainId")).toEqual([]);
});

test("escrow funding is shown in VND and goes through the server action", async ({ page }) => {
  const { actions, walletCalls } = await fixture(page, { state: "Accepted" });
  await page.goto(`/?order=${draft.id}`);
  await expect(page.locator(".summary-amount")).toHaveText("1.000.000 ₫");
  await expect(page.getByTestId("summary-eth")).toHaveText("0.01 ETH");
  await page.getByRole("button", { name: "Ký quỹ 1.000.000 ₫" }).click();
  await expect.poll(() => actions).toEqual([{ action: "deposit" }]);
  expect(walletCalls.filter(method => method !== "eth_accounts" && method !== "eth_chainId")).toEqual([]);
});

test("insufficient balance reports the server's message and keeps the order actionable", async ({ page }) => {
  await fixture(page, { state: "Accepted", failAction: "Số dư không đủ: cần 1.000.000 VND, hiện có 0 VND." });
  await page.goto(`/?order=${draft.id}`);
  await page.getByRole("button", { name: "Ký quỹ 1.000.000 ₫" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Số dư không đủ" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ký quỹ 1.000.000 ₫" })).toBeEnabled();
});

test("Buyer cannot download the product before Seller delivers on chain", async ({ page }) => {
  const file = { id: "00000000-0000-0000-0000-00000000000f", kind: "product", fileName: "site.zip", length: 10, sha256: "0x" + "aa".repeat(32), createdAt: "2026-01-01T00:00:00Z" };
  await fixture(page, { state: "Funded", files: [file] });
  await page.goto(`/?order=${draft.id}`);
  await expect(page.getByText("Mở sau khi Seller xác nhận bàn giao")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tải site.zip" })).toHaveCount(0);
});

test("Buyer can download the product once delivery is on chain", async ({ page }) => {
  const file = { id: "00000000-0000-0000-0000-00000000000f", kind: "product", fileName: "site.zip", length: 10, sha256: "0x" + "aa".repeat(32), createdAt: "2026-01-01T00:00:00Z" };
  await fixture(page, { state: "Delivered", deliveryHash: file.sha256, files: [file] });
  await page.goto(`/?order=${draft.id}`);
  await expect(page.getByRole("button", { name: "Tải site.zip" })).toBeVisible();
});

test("Admin credits an account in VND and verifies a wallet without MetaMask", async ({ page }) => {
  const { credits, verifications, walletCalls } = await fixture(page, { email: "viego.hvnh@gmail.com" });
  await page.goto("/");
  const panel = page.getByLabel("Tài khoản người dùng");
  await expect(panel.getByRole("cell", { name: /^Buyer Test buyer@/ })).toBeVisible();
  await panel.getByRole("button", { name: "Xác minh", exact: true }).click();
  await expect.poll(() => verifications).toEqual([{ address: seller, verified: true }]);
  // A self-held wallet has no ledger balance to credit.
  await expect(panel.locator(".admin-credit select option")).toHaveCount(2);
  await panel.locator(".admin-credit select").selectOption(seller);
  await panel.getByLabel("Số tiền (VND)").fill("2.500.000");
  await panel.getByRole("button", { name: "Nạp tiền", exact: true }).click();
  await expect.poll(() => credits.length).toBe(1);
  expect(credits[0]).toMatchObject({ address: seller, amountVnd: 2500000 });
  expect((credits[0] as { reference: string }).reference).toMatch(/^[0-9a-f-]{36}$/);
  expect(walletCalls.filter(method => method !== "eth_accounts" && method !== "eth_chainId")).toEqual([]);
});
