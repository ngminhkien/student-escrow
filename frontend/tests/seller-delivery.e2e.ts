import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { Interface, sha256, toUtf8Bytes } from "ethers";
import abi from "../../blockchain/deployment/Escrow.abi.json" with { type: "json" };
import type { OrderView } from "../src/domain/types";

const buyer = "0x1111111111111111111111111111111111111111";
const seller = "0x2222222222222222222222222222222222222222";
const network = { status: "Ready", deploymentId: "delivery-test", chainId: "31337", contractAddress: "0x4444444444444444444444444444444444444444", deploymentBlock: 1, deploymentBlockHash: "0x" + "ab".repeat(32) };
const zip = Buffer.from("UEsDBBQAAAAAAKGYRl1YeXccKgAAACoAAAAKAAAAaW5kZXguaHRtbDwhZG9jdHlwZSBodG1sPjxoMT5TdHVkZW50RXNjcm93IGRlbW88L2gxPlBLAQIUABQAAAAAAKGYRl1YeXccKgAAACoAAAAKAAAAAAAAAAAAAACAAQAAAABpbmRleC5odG1sUEsFBgAAAAABAAEAOAAAAFIAAAAAAA==", "base64");
const product = { id: "product", kind: "product", fileName: "landing-page.zip", length: zip.length, sha256: sha256(zip), createdAt: "2026-01-01T00:00:00Z" };
type Stage = "Draft" | "Created" | "Funded" | "Expired" | "Archived";
async function setup(page: Page, stage: Stage = "Funded", sync = true) {
  const draft = { id: "00000000-0000-0000-0000-000000000002", deploymentId: network.deploymentId, buyer, seller, arbiter: "0x3333333333333333333333333333333333333333", amountWei: "10000000000000000", description: "Seller delivery test", acceptanceCriteria: "Landing page responsive", deliveryDeadline: stage === "Expired" ? 1699999999 : 2000000000, reviewWindow: 300, clientReference: "0x" + "11".repeat(32), termsJson: "", termsHash: "", createdAt: "2026-01-01T00:00:00Z" };
  draft.termsJson = JSON.stringify({ version: 1, chainId: 31337, contract: network.contractAddress, deploymentId: draft.deploymentId, buyer, seller, arbiter: draft.arbiter, amountWei: draft.amountWei, description: draft.description, acceptanceCriteria: draft.acceptanceCriteria, deliveryDeadline: draft.deliveryDeadline, reviewWindow: draft.reviewWindow, clientReference: draft.clientReference, feeBps: 100 });
  draft.termsHash = sha256(toUtf8Bytes(draft.termsJson));
  const view: OrderView = { draft, chain: stage === "Draft" ? null : { orderId: "1", state: stage === "Created" ? "Created" : "Funded", deliveryHash: null, reviewDeadline: null, buyerRefundWei: "0", sellerNetWei: "0", platformFeeWei: "0" }, termsMatch: stage !== "Draft", syncStatus: stage === "Archived" ? "Archived" : "Ready", lastIndexedBlock: 1, checkedAt: "2099-01-01T00:00:00Z", files: [], deliveryFileMatchesChain: false };
  const calls: { from: string; method: string; args: unknown[] }[] = [];
  let uploads = 0;
  await page.exposeFunction("__minedDelivery", (data: string, from: string) => {
    const decoded = new Interface(abi).parseTransaction({ data })!;
    calls.push({ from, method: decoded.name, args: [...decoded.args].map(value => typeof value === "bigint" ? value.toString() : value) });
    if (!sync) return;
    if (decoded.name === "markDelivered") {
      view.chain!.state = "Delivered"; view.chain!.deliveryHash = product.sha256; view.chain!.reviewDeadline = 1700000300;
      view.deliveryFileMatchesChain = true;
    } else if (decoded.name === "confirmReceipt") {
      view.chain!.state = "Completed"; view.chain!.sellerNetWei = "9900000000000000"; view.chain!.platformFeeWei = "100000000000000";
    } else if (decoded.name === "raiseDispute") {
      view.chain!.state = "Disputed";
    }
  });
  await page.addInitScript(({ buyer, seller, network }) => {
    sessionStorage.setItem("escrow.session", JSON.stringify({ accessToken: "seller-token", expiresAt: "2099-01-01T00:00:00Z", user: { id: "seller", fullName: "Seller", email: "seller@gmail.com" } }));
    const state = { account: seller, sends: [] as any[], reject: false, data: "0x", from: seller, reported: false };
    (window as any).__delivery = state;
    const hash = "0x" + "12".repeat(32);
    const word = (n: number) => "0x" + n.toString(16).padStart(64, "0");
    const rpc = async ({ method, params = [] }: { method: string; params?: any[] }): Promise<any> => {
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [state.account];
      if (method === "eth_chainId") return "0x7a69";
      if (method === "eth_blockNumber") return "0x2";
      if (method === "eth_getCode") return "0x01";
      if (method === "eth_call") return "0x";
      if (method === "eth_estimateGas") return "0x5208";
      if (method === "eth_getTransactionCount") return "0x0";
      if (method === "eth_getBalance") return "0xde0b6b3a7640000";
      if (method === "eth_gasPrice" || method === "eth_maxPriorityFeePerGas") return "0x3b9aca00";
      if (method === "eth_getBlockByNumber") return { hash: network.deploymentBlockHash, parentHash: network.deploymentBlockHash, number: "0x2", timestamp: "0x6553f100", nonce: "0x0000000000000000", difficulty: "0x0", gasLimit: "0x1c9c380", gasUsed: "0x5208", miner: buyer, extraData: "0x", transactions: [], baseFeePerGas: "0x3b9aca00" };
      if (method === "eth_sendTransaction") {
        state.sends.push(params[0]);
        if (state.reject) { state.reject = false; throw Object.assign(new Error("Rejected"), { code: 4001 }); }
        state.data = params[0].data; state.from = state.account; state.reported = false; return hash;
      }
      if (method === "eth_getTransactionByHash") return { hash, blockHash: network.deploymentBlockHash, blockNumber: "0x2", transactionIndex: "0x0", from: state.from, to: network.contractAddress, nonce: "0x0", gas: "0x6270", gasPrice: "0x3b9aca00", value: "0x0", input: state.data, chainId: "0x7a69", type: "0x2", maxFeePerGas: "0xb2d05e00", maxPriorityFeePerGas: "0x3b9aca00", accessList: [], v: "0x0", r: word(1), s: word(2) };
      if (method === "eth_getTransactionReceipt") {
        if (state.data === "0x") return null;
        if (!state.reported) { state.reported = true; await (window as any).__minedDelivery(state.data, state.from); }
        return { transactionHash: hash, transactionIndex: "0x0", blockHash: network.deploymentBlockHash, blockNumber: "0x2", from: state.from, to: network.contractAddress, contractAddress: null, cumulativeGasUsed: "0x5208", gasUsed: "0x5208", effectiveGasPrice: "0x3b9aca00", logs: [], logsBloom: "0x" + "00".repeat(256), status: "0x1", type: "0x2" };
      }
      throw new Error(`Unexpected RPC ${method}`);
    };
    (window as any).__deliveryRpc = rpc;
    window.ethereum = { request: rpc };
  }, { buyer, seller, network });
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/login")) return route.fulfill({ json: { accessToken: "buyer-token", expiresAt: "2099-01-01T00:00:00Z", user: { id: "buyer", fullName: "Buyer", email: "buyer@gmail.com" } } });
    if (path.endsWith("/wallets/me")) return route.fulfill({ json: { linked: true, address: route.request().headers().authorization?.includes("buyer-token") ? buyer : seller, chainId: 31337 } });
    if (path.endsWith("/files") && route.request().method() === "POST") {
      expect(route.request().postDataBuffer()?.includes(zip)).toBe(true);
      uploads++; view.files = [product];
      return route.fulfill({ status: 201, json: product });
    }
    if (path.endsWith("/files/product")) return route.fulfill({ body: zip, contentType: "application/octet-stream" });
    return route.fulfill({ json: path.endsWith("/health/blockchain") ? network : path.endsWith("/orders") ? [view] : path.endsWith("/events") ? [] : view });
  });
  await page.route("**/rpc", async route => {
    const input = route.request().postDataJSON();
    const answer = async (r: any) => ({ jsonrpc: "2.0", id: r.id, result: await page.evaluate(r => (window as any).__deliveryRpc(r), r) });
    try { await route.fulfill({ json: Array.isArray(input) ? await Promise.all(input.map(answer)) : await answer(input) }); }
    catch (error) { if (!/Execution context was destroyed|Target page, context or browser has been closed/.test(String(error))) throw error; }
  });
  await page.goto(`/?order=${draft.id}`);
  await expect(page.getByRole("region", { name: "Chi tiết đơn", exact: true })).toBeVisible();
  return { calls, getUploads: () => uploads };
}

async function upload(page: Page) {
  await page.getByLabel("Chọn ZIP mã nguồn", { exact: true }).setInputFiles({ name: product.fileName, mimeType: "application/zip", buffer: zip });
  await page.getByRole("button", { name: "Tải ZIP mã nguồn", exact: true }).click();
  await expect(page.getByRole("button", { name: "Tải landing-page.zip", exact: true })).toBeVisible();
}

test("mocked Seller uploads ZIP, confirms via wallet; Buyer downloads and accepts", async ({ page }) => {
  const fixture = await setup(page);
  await expect(page.getByRole("button", { name: "Tạo bản nháp", exact: true })).toHaveCount(0);
  const deliver = page.getByRole("button", { name: "Xác nhận đã gửi code", exact: true });
  await expect(deliver).toBeDisabled();
  await expect(page.getByRole("button", { name: "Mở tranh chấp", exact: true })).toBeDisabled();
  await upload(page);
  await expect(page.getByRole("button", { name: "Mở tranh chấp", exact: true })).toBeDisabled();
  expect(fixture.getUploads()).toBe(1);
  expect(await page.evaluate(() => (window as any).__delivery.sends.length)).toBe(0);
  await expect(deliver).toBeDisabled();
  await mkdir("../.artifacts", { recursive: true });
  await page.screenshot({ path: "../.artifacts/seller-workflow-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 375, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "../.artifacts/seller-workflow-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByLabel("Tôi xác nhận ZIP đã tải lên", { exact: false }).check();
  await deliver.click();
  await expect(page.getByTestId("order-state")).toHaveText("Đã bàn giao");
  await expect(page.getByRole("button", { name: "Mở tranh chấp", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Đã xác nhận bàn giao", exact: true })).toBeDisabled();
  expect(fixture.calls[0]).toEqual({ from: seller, method: "markDelivered", args: ["1", product.sha256] });
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await page.evaluate(buyer => { (window as any).__delivery.account = buyer; }, buyer);
  await page.getByLabel("Email", { exact: true }).fill("buyer@gmail.com");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  if (!new URL(page.url()).searchParams.has("order")) await page.getByRole("button", { name: "Mở đơn Seller delivery test", exact: true }).click();
  const download = page.waitForEvent("download");
  await expect(page.getByRole("button", { name: "Mở tranh chấp", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Hoàn tiền do quá hạn giao", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Tải landing-page.zip", exact: true }).click();
  expect((await download).suggestedFilename()).toBe(product.fileName);
  await expect(page.getByRole("button", { name: "Xác nhận đã gửi code", exact: true })).toHaveCount(0);
  await page.getByLabel("Tôi đã kiểm tra file", { exact: false }).check();
  await page.getByRole("button", { name: "Xác nhận nghiệm thu", exact: true }).click();
  await expect(page.getByTestId("order-state")).toHaveText("Hoàn thành");
  expect(fixture.calls[1]).toEqual({ from: buyer, method: "confirmReceipt", args: ["1"] });
});

test("mocked dispute opens only after on-chain delivery and cannot be submitted twice", async ({ page }) => {
  const fixture = await setup(page);
  const dispute = page.getByRole("button", { name: "Mở tranh chấp", exact: true });
  await expect(dispute).toBeDisabled();
  await upload(page);
  await expect(dispute).toBeDisabled();
  await page.getByLabel("Tôi xác nhận ZIP đã tải lên", { exact: false }).check();
  await page.getByRole("button", { name: "Xác nhận đã gửi code", exact: true }).click();
  await expect(dispute).toBeEnabled();
  await dispute.click();
  await expect(page.getByTestId("order-state")).toHaveText("Đang tranh chấp");
  await expect(dispute).toBeDisabled();
  expect(fixture.calls.map(call => call.method)).toEqual(["markDelivered", "raiseDispute"]);
});

test("mocked rejected delivery allows retry; confirmed delivery stays locked while SQL lags", async ({ page }) => {
  await setup(page, "Funded", false);
  await upload(page);
  await page.getByLabel("Tôi xác nhận ZIP đã tải lên", { exact: false }).check();
  await page.evaluate(() => { (window as any).__delivery.reject = true; });
  await page.getByRole("button", { name: "Xác nhận đã gửi code", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "từ chối" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Xác nhận đã gửi code", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Xác nhận đã gửi code", exact: true }).click();
  await expect(page.getByRole("button", { name: "Đang chờ xác nhận bàn giao", exact: true })).toBeDisabled();
  await expect(page.getByTestId("order-state")).toHaveText("Đã ký quỹ");
  await page.reload();
  await expect(page.getByRole("button", { name: "Đang chờ xác nhận bàn giao", exact: true })).toBeDisabled();
});

for (const [stage, reason] of [["Draft", "Buyer chưa tạo đơn"], ["Created", "Buyer chưa nạp ETH"], ["Expired", "Đã quá hạn giao"], ["Archived", "Đơn thuộc deployment cũ"]] as const) {
  test(`mocked Seller sees disabled delivery and a reason for ${stage}`, async ({ page }) => {
    await setup(page, stage);
    await expect(page.getByRole("button", { name: "Xác nhận đã gửi code", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Mở tranh chấp", exact: true })).toBeDisabled();
    await expect(page.getByRole("region", { name: "Xác nhận bàn giao mã nguồn", exact: true })).toContainText(reason);
    expect(await page.evaluate(() => (window as any).__delivery.sends.length)).toBe(0);
  });
}
