import { test, expect } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { JsonRpcProvider, Wallet, getBytes, parseEther } from "ethers";
import type { Signer } from "ethers";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

const rpc = new JsonRpcProvider("http://127.0.0.1:8545");
test.afterAll(() => rpc.destroy());
const zip = Buffer.from("UEsDBBQAAAAAAKGYRl1YeXccKgAAACoAAAAKAAAAaW5kZXguaHRtbDwhZG9jdHlwZSBodG1sPjxoMT5TdHVkZW50RXNjcm93IGRlbW88L2gxPlBLAQIUABQAAAAAAKGYRl1YeXccKgAAACoAAAAKAAAAAAAAAAAAAACAAQAAAABpbmRleC5odG1sUEsFBgAAAAABAAEAOAAAAFIAAAAAAA==", "base64");
type TestWallet = { account: string; chain: string; reject: boolean; change: (account: string, chain: string) => void };
declare global { interface Window { __walletRpc: (input: { method: string; params?: unknown[] }) => Promise<{ result?: unknown; error?: { message: string; code?: string | number } }>; __testWallet: TestWallet } }

// The injected EIP-1193 wallet simulates extension prompts only. Its Node-side signer
// signs real transactions on Hardhat, and every API call uses real SQL/backend.
async function actorPage(browser: Browser, signer: Signer) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const actorAddress = await signer.getAddress();
  await page.exposeBinding("__walletRpc", async (_source, input: { method: string; params?: unknown[] }) => {
    try {
      const params = input.params ?? [];
      if (input.method === "personal_sign") return { result: await signer.signMessage(getBytes(String(params[0]))) };
      if (input.method === "eth_sendTransaction") {
        const tx = params[0] as Record<string, string>;
        if (tx.from.toLowerCase() !== actorAddress.toLowerCase()) throw new Error("Test signer does not own requested address");
        const response = await signer.sendTransaction({ to: tx.to, data: tx.data, value: tx.value,
          gasLimit: tx.gas, gasPrice: tx.gasPrice, maxFeePerGas: tx.maxFeePerGas, maxPriorityFeePerGas: tx.maxPriorityFeePerGas });
        return { result: response.hash };
      }
      return { result: await rpc.send(input.method, params) };
    } catch (error) {
      const failure = error as Error & { code?: string | number };
      return { error: { message: failure.message, code: failure.code } };
    }
  });
  await page.addInitScript(({ account }) => {
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
    let connected = false;
    window.__testWallet = { account, chain: "0x7a69", reject: false,
      change(next, chain) {
        this.account = next; this.chain = chain;
        for (const listener of listeners.accountsChanged ?? []) listener([next]);
        for (const listener of listeners.chainChanged ?? []) listener(chain);
      } };
    window.ethereum = {
      isMetaMask: true,
      on(event, callback) { (listeners[event] ??= []).push(callback); },
      removeListener(event, callback) { listeners[event] = (listeners[event] ?? []).filter(item => item !== callback); },
      async request(input) {
        const { method } = input;
        const params = input.params as unknown[] | undefined;
        if (window.__testWallet.reject && ["personal_sign", "eth_sendTransaction"].includes(method)) {
          window.__testWallet.reject = false;
          throw Object.assign(new Error("User rejected request"), { code: 4001 });
        }
        if (method === "eth_requestAccounts") { connected = true; return [window.__testWallet.account]; }
        if (method === "eth_accounts") return connected ? [window.__testWallet.account] : [];
        if (method === "eth_chainId") return window.__testWallet.chain;
        if (method === "wallet_switchEthereumChain") {
          window.__testWallet.chain = "0x7a69";
          for (const listener of listeners.chainChanged ?? []) listener("0x7a69");
          return null;
        }
        const reply = await window.__walletRpc({ method, params });
        if (reply.error) throw Object.assign(new Error(reply.error.message), { code: reply.error.code });
        return reply.result;
      }
    };
  }, { account: actorAddress });
  await page.goto("/");
  await expect(page.getByText("Blockchain: Ready", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Kết nối MetaMask", exact: true }).click();
  await expect(page.getByRole("button", { name: "Kết nối lại ví" })).toBeEnabled();
  return { page, context, address: actorAddress };
}

async function register(page: Page, email: string) {
  await page.getByRole("button", { name: "Chưa có tài khoản? Đăng ký" }).click();
  await page.getByLabel("Họ tên", { exact: true }).fill("Demo Student");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("DemoPassword123!");
  await page.getByRole("button", { name: "Đăng ký", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ký và liên kết ví" })).toBeEnabled();
  await page.getByRole("button", { name: "Ký và liên kết ví" }).click();
  await expect(page.getByText("Ví đã liên kết cố định.", { exact: false })).toBeVisible();
}
async function openOrder(page: Page, id: string) {
  await page.getByRole("button", { name: "Đơn hàng", exact: true }).click();
  await page.getByLabel("Mở bằng mã đơn").fill(id);
  await page.getByRole("button", { name: "Mở mã đơn", exact: true }).click();
  await expect(page.locator(".order-detail")).toBeVisible();
}

test("Real UI/API/SQL/chain: roles, KYC, files, settlement, wrong wallet/network, rejection and dispute", async ({ browser }, testInfo) => {
  const ready = await fetch("http://localhost:5180/api/health/blockchain");
  expect(ready.status, "Start Hardhat, deploy, and start API with -Blockchain before this test").toBe(200);
  const adminSigner = await rpc.getSigner(0);
  const signers = [Wallet.createRandom().connect(rpc), Wallet.createRandom().connect(rpc), Wallet.createRandom().connect(rpc)];
  for (const signer of signers) await (await adminSigner.sendTransaction({ to: signer.address, value: parseEther("1") })).wait();
  const admin = await actorPage(browser, adminSigner);
  const buyer = await actorPage(browser, signers[0]);
  const seller = await actorPage(browser, signers[1]);
  const arbiter = await actorPage(browser, signers[2]);
  const errors: string[] = [];
  for (const actor of [admin, buyer, seller, arbiter]) actor.page.on("pageerror", error => errors.push(error.message));
  const run = randomUUID();
  await register(buyer.page, `ui.${run}.buyer@example.test`);
  await register(seller.page, `ui.${run}.seller@example.test`);
  await register(arbiter.page, `ui.${run}.arbiter@example.test`);
  console.log("PASS UI register/link for Buyer, Seller and Arbiter");

  await buyer.page.getByLabel("Giấy tờ mẫu").selectOption("DEMO-DOCUMENT-FAIL");
  await buyer.page.getByRole("button", { name: "Nộp KYC demo", exact: true }).click();
  await expect(buyer.page.getByText("REJECTED", { exact: true })).toBeVisible();
  await buyer.page.getByLabel("Giấy tờ mẫu").selectOption("DEMO-DOCUMENT-PASS");
  await buyer.page.getByRole("button", { name: "Nộp KYC demo", exact: true }).click();
  await expect(buyer.page.getByText("VERIFIED", { exact: true })).toBeVisible();

  await admin.page.getByRole("button", { name: "Admin", exact: true }).click();
  for (const actor of [buyer, seller]) {
    await admin.page.getByLabel("Địa chỉ ví cần quản lý").fill(actor.address);
    await expect(admin.page.getByRole("button", { name: "Xác minh ví", exact: true })).toBeEnabled();
    await admin.page.getByRole("button", { name: "Xác minh ví", exact: true }).click();
    await expect(admin.page.getByRole("status").filter({ hasText: "Xác minh ví on-chain: hoàn tất" })).toBeVisible();
    await expect(admin.page.locator(".banner").filter({ hasText: "Xác minh: Có" })).toBeVisible();
  }
  await buyer.page.getByRole("button", { name: "Admin", exact: true }).click();
  await buyer.page.getByLabel("Địa chỉ ví cần quản lý").fill(seller.address);
  await expect(buyer.page.getByRole("button", { name: "Xác minh ví", exact: true })).toBeDisabled();

  await buyer.page.getByRole("button", { name: "Đơn hàng", exact: true }).click();
  // Explicit account/network change events must invalidate signing eligibility.
  await buyer.page.evaluate(address => window.__testWallet.change(address, "0x1"), buyer.address);
  await expect(buyer.page.getByRole("alert").filter({ hasText: "Sai mạng" })).toBeVisible();
  await expect(buyer.page.getByRole("button", { name: "Tạo bản nháp", exact: true })).toBeDisabled();
  await buyer.page.getByRole("button", { name: "Chuyển sang mạng local" }).click();
  await buyer.page.evaluate(address => window.__testWallet.change(address, "0x7a69"), seller.address);
  await expect(buyer.page.getByRole("alert").filter({ hasText: "khác ví liên kết" })).toBeVisible();
  await expect(buyer.page.getByRole("button", { name: "Tạo bản nháp", exact: true })).toBeDisabled();
  await buyer.page.evaluate(address => window.__testWallet.change(address, "0x7a69"), buyer.address);
  console.log("PASS UI KYC, Admin verification, wrong wallet and wrong network");

  async function createDraft(description: string, reviewWindow = "300") {
    await buyer.page.getByRole("button", { name: "Tạo bản nháp", exact: true }).click();
    await buyer.page.getByLabel("Ví Seller", { exact: true }).fill(seller.address);
    await buyer.page.getByLabel("Ví Arbiter", { exact: true }).fill(arbiter.address);
    await buyer.page.getByLabel("Nội dung công việc", { exact: true }).fill(description);
    await buyer.page.getByLabel("Tiêu chí nghiệm thu", { exact: true }).fill("Responsive 375px và 1440px");
    await buyer.page.getByLabel("Thời gian phản hồi (giây)", { exact: true }).fill(reviewWindow);
    await buyer.page.getByRole("button", { name: "Lưu bản nháp", exact: true }).click();
    await expect(buyer.page.getByTestId("order-state")).toHaveText("Bản nháp");
    return new URL(buyer.page.url()).searchParams.get("order")!;
  }
  const orderId = await createDraft(`Landing page ${run}`);
  await buyer.page.evaluate(() => { window.__testWallet.reject = true; });
  await buyer.page.getByRole("button", { name: "Tạo đơn trên chain", exact: true }).click();
  await expect(buyer.page.getByRole("alert").filter({ hasText: "từ chối" })).toBeVisible();
  await expect(buyer.page.getByTestId("order-state")).toHaveText("Bản nháp");
  await buyer.page.getByRole("button", { name: "Tạo đơn trên chain", exact: true }).click();
  await expect(buyer.page.getByTestId("order-state")).toHaveText("Đã tạo trên chain");
  await buyer.page.getByRole("button", { name: "Nạp 0.01 ETH", exact: true }).click();
  await expect(buyer.page.getByTestId("order-state")).toHaveText("Đã ký quỹ");
  await openOrder(seller.page, orderId);
  await seller.page.getByLabel("Loại file", { exact: true }).selectOption("product");
  await seller.page.getByLabel("Chọn file", { exact: true }).setInputFiles({ name: "landing-page.zip", mimeType: "application/zip", buffer: zip });
  await seller.page.getByRole("button", { name: "Upload file", exact: true }).click();
  await expect(seller.page.getByRole("button", { name: "Ký bàn giao", exact: true })).toBeEnabled();
  await seller.page.getByRole("button", { name: "Ký bàn giao", exact: true }).click();
  await expect(buyer.page.getByTestId("order-state")).toHaveText("Đã bàn giao");
  await expect(buyer.page.getByTestId("delivery-match")).toContainText("Khớp ZIP");
  const downloaded = buyer.page.waitForEvent("download");
  await buyer.page.getByRole("button", { name: "Tải landing-page.zip", exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe("landing-page.zip");
  await buyer.page.getByLabel("Tôi đã kiểm tra file", { exact: false }).check();
  await buyer.page.getByRole("button", { name: "Xác nhận nghiệm thu", exact: true }).click();
  await expect(buyer.page.getByTestId("order-state")).toHaveText("Hoàn thành");
  await expect(buyer.page.locator(".order-detail")).toContainText("Seller nhận 0.0099 ETH");
  await expect(buyer.page.getByRole("cell", { name: "Released", exact: true })).toBeVisible();
  console.log("PASS UI create/deposit, wallet rejection, ZIP upload/download, delivery and confirmation");
  await mkdir("../.artifacts", { recursive: true });
  await buyer.page.screenshot({ path: "../.artifacts/frontend-desktop.png", fullPage: true });
  await buyer.page.setViewportSize({ width: 375, height: 812 });
  await buyer.page.screenshot({ path: "../.artifacts/frontend-mobile.png", fullPage: true });
  expect(await buyer.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await buyer.page.setViewportSize({ width: 1280, height: 900 });

  const disputed = await createDraft(`Dispute ${run}`);
  await buyer.page.getByRole("button", { name: "Tạo đơn trên chain", exact: true }).click();
  await expect(buyer.page.getByTestId("order-state")).toHaveText("Đã tạo trên chain");
  await buyer.page.getByRole("button", { name: "Nạp 0.01 ETH", exact: true }).click();
  await expect(buyer.page.getByTestId("order-state")).toHaveText("Đã ký quỹ");
  await buyer.page.getByRole("button", { name: "Mở tranh chấp", exact: true }).click();
  await expect(buyer.page.getByTestId("order-state")).toHaveText("Đang tranh chấp");
  await openOrder(arbiter.page, disputed);
  await arbiter.page.getByLabel("Phần Seller được hưởng (%)", { exact: true }).fill("70");
  await arbiter.page.getByRole("button", { name: "Phân xử và thanh toán", exact: true }).click();
  await expect(arbiter.page.getByTestId("order-state")).toHaveText("Đã phân xử");
  await expect(arbiter.page.locator(".order-detail")).toContainText("Seller nhận 0.00693 ETH");
  console.log("PASS UI Arbiter dispute resolution 70/30");

  const refundId = await createDraft(`Refund ${run}`);
  await buyer.page.getByRole("button", { name: "Tạo đơn trên chain", exact: true }).click();
  await expect(buyer.page.getByTestId("order-state")).toHaveText("Đã tạo trên chain");
  await buyer.page.getByRole("button", { name: "Nạp 0.01 ETH", exact: true }).click();
  await expect(buyer.page.getByTestId("order-state")).toHaveText("Đã ký quỹ");
  const deadline = await buyer.page.evaluate(async id => {
    const session = JSON.parse(sessionStorage.getItem("escrow.session")!);
    const response = await fetch(`/api/orders/${id}`, { headers: { Authorization: `Bearer ${session.accessToken}` } });
    return (await response.json()).draft.deliveryDeadline as number;
  }, refundId);
  await rpc.send("evm_setNextBlockTimestamp", [deadline + 1]); // No mined block: UI must use the pending clock.
  await buyer.page.getByRole("button", { name: "Hoàn tiền do quá hạn giao", exact: true }).click();
  await expect(buyer.page.getByTestId("order-state")).toHaveText("Đã hoàn tiền");

  const timeoutId = await createDraft(`Review timeout ${run}`, "2");
  await buyer.page.getByRole("button", { name: "Tạo đơn trên chain", exact: true }).click();
  await expect(buyer.page.getByTestId("order-state")).toHaveText("Đã tạo trên chain");
  await buyer.page.getByRole("button", { name: "Nạp 0.01 ETH", exact: true }).click();
  await expect(buyer.page.getByTestId("order-state")).toHaveText("Đã ký quỹ");
  await openOrder(seller.page, timeoutId);
  await seller.page.getByLabel("Loại file", { exact: true }).selectOption("product");
  await seller.page.getByLabel("Chọn file", { exact: true }).setInputFiles({ name: "timeout.zip", mimeType: "application/zip", buffer: zip });
  await seller.page.getByRole("button", { name: "Upload file", exact: true }).click();
  await seller.page.getByRole("button", { name: "Ký bàn giao", exact: true }).click();
  await expect(seller.page.getByTestId("order-state")).toHaveText("Đã bàn giao");
  await seller.page.getByRole("button", { name: "Nhận tiền sau hạn phản hồi", exact: true }).click();
  await expect(seller.page.getByTestId("order-state")).toHaveText("Hoàn thành");
  console.log("PASS UI delivery refund and review-timeout claim while local chain is idle");
  expect(errors, "No uncaught browser exceptions").toEqual([]);
  await testInfo.attach("deployment", { body: JSON.stringify(await ready.json()), contentType: "application/json" });
  for (const actor of [admin, buyer, seller, arbiter]) await actor.context.close();
});
