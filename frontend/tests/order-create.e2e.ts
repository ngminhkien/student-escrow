import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { id, sha256, toUtf8Bytes } from "ethers";

const account = "0x1111111111111111111111111111111111111111";
const network = { status: "Ready", deploymentId: "create-test", chainId: "31337", contractAddress: "0x4444444444444444444444444444444444444444", deploymentBlock: 1, deploymentBlockHash: "0x" + "ab".repeat(32) };
const draft = { id: "00000000-0000-0000-0000-000000000001", deploymentId: network.deploymentId, buyer: account, seller: "0x2222222222222222222222222222222222222222", arbiter: "0x3333333333333333333333333333333333333333", amountWei: "1000", description: "Create once", acceptanceCriteria: "Test", deliveryDeadline: 2000000000, reviewWindow: 300, clientReference: "0x" + "11".repeat(32), termsJson: "", termsHash: "", createdAt: "2026-01-01T00:00:00Z" };
draft.termsJson = JSON.stringify({ version: 1, chainId: 31337, contract: network.contractAddress, deploymentId: draft.deploymentId, buyer: draft.buyer, seller: draft.seller, arbiter: draft.arbiter, amountWei: draft.amountWei, description: draft.description, acceptanceCriteria: draft.acceptanceCriteria, deliveryDeadline: draft.deliveryDeadline, reviewWindow: draft.reviewWindow, clientReference: draft.clientReference, feeBps: 100 });
draft.termsHash = sha256(toUtf8Bytes(draft.termsJson));
const view = { draft, chain: null, termsMatch: false, syncStatus: "Ready", files: [], deliveryFileMatchesChain: false, lastIndexedBlock: 1, checkedAt: "2099-01-01T00:00:00Z" };
const usedSelector = id("usedClientReferences(address,bytes32)").slice(0, 10);
const verifiedSelector = id("verifiedWallets(address)").slice(0, 10);

async function fixture(page: Page, mode: "confirmed" | "rejected" | "pending" | "existing" | "failed" | "unverified") {
  await page.addInitScript(({ account, network, mode, usedSelector, verifiedSelector }) => {
    sessionStorage.setItem("escrow.session", JSON.stringify({ accessToken: "create", expiresAt: "2099-01-01T00:00:00Z", user: { id: "create", fullName: "Create test", email: "test@gmail.com" } }));
    const hash = "0x" + "12".repeat(32);
    const blockHash = network.deploymentBlockHash;
    const word = (n: number) => "0x" + n.toString(16).padStart(64, "0");
    const state = { sends: 0, mined: mode !== "pending", used: mode === "existing" || sessionStorage.getItem("mock.create.used") === "1", verified: mode !== "unverified", reject: mode === "rejected", revert: mode === "failed", sent: false, data: "0x" };
    (window as any).__createFixture = state;
    const rpc = async ({ method, params = [] }: { method: string; params?: any[] }): Promise<any> => {
      if (method === "eth_chainId") return "0x7a69";
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [account];
      if (method === "eth_getCode") return "0x01";
      if (method === "eth_blockNumber") return state.mined ? "0x2" : "0x1";
      if (method === "eth_getTransactionCount") return state.sent ? "0x1" : "0x0";
      if (method === "eth_call") return params[0]?.data?.startsWith(usedSelector) ? word(state.used ? 1 : 0) : params[0]?.data?.startsWith(verifiedSelector) ? word(state.verified ? 1 : 0) : word(1);
      if (method === "eth_estimateGas") return "0x5208";
      if (method === "eth_getBalance") return "0xde0b6b3a7640000";
      if (method === "eth_gasPrice" || method === "eth_maxPriorityFeePerGas") return "0x3b9aca00";
      if (method === "eth_getBlockByNumber") return { hash: blockHash, parentHash: blockHash, number: "0x2", timestamp: "0x6553f100", nonce: "0x0000000000000000", difficulty: "0x0", gasLimit: "0x1c9c380", gasUsed: "0x5208", miner: account, extraData: "0x", transactions: [], baseFeePerGas: "0x3b9aca00" };
      if (method === "eth_sendTransaction") {
        state.sends++;
        if (state.reject) { state.reject = false; throw Object.assign(new Error("Rejected"), { code: 4001 }); }
        state.sent = true; state.data = params[0].data;
        if (state.mined && !state.revert) { state.used = true; sessionStorage.setItem("mock.create.used", "1"); }
        return hash;
      }
      if (method === "eth_getTransactionByHash") return { hash, blockHash: state.mined ? blockHash : null, blockNumber: state.mined ? "0x2" : null, transactionIndex: state.mined ? "0x0" : null, from: account, to: network.contractAddress, nonce: "0x0", gas: "0x6270", gasPrice: "0x3b9aca00", value: "0x0", input: state.data, chainId: "0x7a69", type: "0x2", maxFeePerGas: "0xb2d05e00", maxPriorityFeePerGas: "0x3b9aca00", accessList: [], v: "0x0", r: word(1), s: word(2) };
      if (method === "eth_getTransactionReceipt") return state.sent && state.mined ? { transactionHash: hash, transactionIndex: "0x0", blockHash, blockNumber: "0x2", from: account, to: network.contractAddress, contractAddress: null, cumulativeGasUsed: "0x5208", gasUsed: "0x5208", effectiveGasPrice: "0x3b9aca00", logs: [], logsBloom: "0x" + "00".repeat(256), status: state.revert ? "0x0" : "0x1", type: "0x2" } : null;
      throw new Error(`Unexpected RPC ${method}`);
    };
    (window as any).__createRpc = rpc;
    window.ethereum = { request: rpc };
  }, { account, network, mode, usedSelector, verifiedSelector });
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path.endsWith("/health/blockchain") ? network : path.endsWith("/wallets/me") ? { linked: true, address: account, chainId: 31337 } : path.endsWith("/orders") ? [view] : path.endsWith("/events") ? [] : view });
  });
  await page.route("**/rpc", async route => {
    const input = route.request().postDataJSON();
    const answer = async (r: any) => ({ jsonrpc: "2.0", id: r.id, result: await page.evaluate(r => (window as any).__createRpc(r), r) });
    try { await route.fulfill({ json: Array.isArray(input) ? await Promise.all(input.map(answer)) : await answer(input) }); }
    catch (failure) {
      if (!/Execution context was destroyed|Target page, context or browser has been closed|Frame was detached/.test(String(failure))) throw failure;
      await route.abort().catch(() => {});
    }
  });
  await page.goto(`/?order=${draft.id}`);
}

test("mocked confirmed create stays disabled while SQL is still a draft and after reload", async ({ page }) => {
  await fixture(page, "confirmed");
  await page.getByRole("button", { name: "Tạo đơn trên chain", exact: true }).click();
  await expect(page.getByText("Đơn đã được tạo trên blockchain.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Đã tạo trên chain", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).__createFixture.sends)).toBe(1);
  await page.reload();
  await expect(page.getByRole("button", { name: "Đã tạo trên chain", exact: true })).toBeDisabled();
});

test("mocked rejected create allows retry", async ({ page }) => {
  await fixture(page, "rejected");
  await page.getByRole("button", { name: "Tạo đơn trên chain", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "từ chối" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tạo đơn trên chain", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Tạo đơn trên chain", exact: true }).click();
  await expect(page.getByRole("button", { name: "Đã tạo trên chain", exact: true })).toBeDisabled();
});

test("mocked pending create stays locked after reload", async ({ page }) => {
  await fixture(page, "pending");
  await page.getByRole("button", { name: "Tạo đơn trên chain", exact: true }).click();
  await expect(page.getByRole("button", { name: "Đang chờ xác nhận / đồng bộ", exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole("button", { name: "Đang chờ xác nhận / đồng bộ", exact: true })).toBeDisabled();
});

test("mocked reference already on chain prevents another create prompt", async ({ page }) => {
  await fixture(page, "existing");
  await expect(page.getByRole("button", { name: "Đã tạo trên chain", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).__createFixture.sends)).toBe(0);
});

test("mocked failed receipt unlocks create for another attempt", async ({ page }) => {
  await fixture(page, "failed");
  await page.getByRole("button", { name: "Tạo đơn trên chain", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tạo đơn trên chain", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => sessionStorage.getItem("escrow.order-create.create-test.00000000-0000-0000-0000-000000000001"))).toBeNull();
});

test("mocked unverified Buyer/Seller show a local reason and never open a transaction prompt", async ({ page }) => {
  await fixture(page, "unverified");
  const notice = page.getByRole("region", { name: "Điều kiện xác minh ví", exact: true });
  await expect(notice).toContainText("Cần Admin xác minh ví");
  await expect(notice).toContainText("Buyer: Chưa xác minh");
  await expect(notice).toContainText("Seller: Chưa xác minh");
  await expect(page.getByRole("button", { name: "Tạo đơn trên chain", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).__createFixture.sends)).toBe(0);
  await page.evaluate(() => { (window as any).__createFixture.verified = true; });
  await page.getByRole("button", { name: "Kiểm tra lại xác minh ví", exact: true }).click();
  await expect(page.getByRole("button", { name: "Tạo đơn trên chain", exact: true })).toBeEnabled();
  await expect(notice).toHaveCount(0);
});
