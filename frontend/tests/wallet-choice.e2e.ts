import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

const adminWallet = "0x1111111111111111111111111111111111111111";
const network = { status: "Ready", deploymentId: "choice-test", chainId: "31337", contractAddress: "0x4444444444444444444444444444444444444444", deploymentBlock: 1, deploymentBlockHash: "0x" + "ab".repeat(32), syncedBlock: 1, latestBlock: 1, message: "" };
const session = { accessToken: "choice", tokenType: "Bearer", expiresAt: "2099-01-01T00:00:00Z", user: { id: "u1", fullName: "Choice Test", email: "choice@example.test", createdAt: "2026-11-04T00:00:00Z" } };

async function registration(page: Page) {
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/register")) { bodies.push(route.request().postDataJSON()); return route.fulfill({ status: 201, json: session }); }
    return route.fulfill({ json: path.endsWith("/health/blockchain") ? network
      : path.endsWith("/wallets/me") ? { linked: false, address: null, chainId: null, custodial: false }
      : path.endsWith("/kyc/me") ? { status: "NOT_SUBMITTED", isMock: true, reasonCode: null, maskedStudentNumber: null }
      : [] });
  });
  await page.route("**/rpc", route => route.fulfill({ json: { jsonrpc: "2.0", id: route.request().postDataJSON()?.id ?? 1, result: "0x2" } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Chưa có tài khoản? Đăng ký" }).click();
  await page.getByLabel("Họ tên", { exact: true }).fill("Choice Test");
  await page.getByLabel("Email", { exact: true }).fill("choice@example.test");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("DemoPassword123!");
  return bodies;
}

test("registration defaults to a platform-held wallet", async ({ page }) => {
  const bodies = await registration(page);
  await expect(page.getByRole("radio", { name: /Hệ thống giữ ví hộ/ })).toBeChecked();
  await page.getByRole("button", { name: "Đăng ký", exact: true }).click();
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0].useExternalWallet).toBe(false);
});

test("choosing MetaMask registers without a generated wallet and leads to linking", async ({ page }) => {
  const bodies = await registration(page);
  await page.getByRole("radio", { name: /Tự giữ ví bằng MetaMask/ }).check();
  await page.getByRole("button", { name: "Đăng ký", exact: true }).click();
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0].useExternalWallet).toBe(true);
  await page.getByRole("button", { name: "Tài khoản & ví" }).click();
  await expect(page.getByRole("heading", { name: "Liên kết ví" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Nạp tiền" })).toHaveCount(0);
});

test("the choice is offered only when registering", async ({ page }) => {
  await registration(page);
  await expect(page.getByRole("group", { name: "Cách giữ ví" })).toBeVisible();
  await page.getByRole("button", { name: "Đã có tài khoản? Đăng nhập" }).click();
  await expect(page.getByRole("group", { name: "Cách giữ ví" })).toHaveCount(0);
});

for (const width of [375, 1440]) test(`the choice fits at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await registration(page);
  await expect(page.getByRole("group", { name: "Cách giữ ví" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `../.artifacts/wallet-choice/register-${width}.png`, fullPage: true });
});

test("an Admin on MetaMask still sees the account list, and signs chain actions in the wallet", async ({ page }) => {
  const apiWrites: string[] = [];
  const walletCalls: string[] = [];
  await page.exposeFunction("__walletCalled", (method: string) => { walletCalls.push(method); });
  await page.addInitScript(({ wallet, user, blockHash }) => {
    sessionStorage.setItem("escrow.session", JSON.stringify({ accessToken: "admin", expiresAt: "2099-01-01T00:00:00Z", user }));
    (window as any).ethereum = { isMetaMask: true, on() {}, removeListener() {}, request: async ({ method }: { method: string }) => {
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [wallet];
      if (method === "eth_chainId") return "0x7a69";
      if (method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts" }];
      await (window as any).__walletCalled(method);
      if (method === "eth_sendTransaction") throw Object.assign(new Error("User rejected request"), { code: 4001 });
      if (method === "eth_getBlockByNumber") return { hash: blockHash, parentHash: blockHash, number: "0x2", timestamp: "0x6553f100", nonce: "0x0000000000000000", difficulty: "0x0", gasLimit: "0x1c9c380", gasUsed: "0x0", miner: wallet, extraData: "0x", transactions: [], baseFeePerGas: "0x1" };
      if (method === "eth_getCode") return "0x01";
      if (method === "eth_call") return "0x" + "0".repeat(63) + "1";
      if (method === "eth_getBalance") return "0xde0b6b3a7640000";
      if (method === "eth_estimateGas") return "0x5208";
      if (method === "eth_gasPrice" || method === "eth_maxPriorityFeePerGas") return "0x3b9aca00";
      return "0x2";
    } };
  }, { wallet: adminWallet, user: { id: "admin", fullName: "Admin", email: "viego.hvnh@gmail.com" }, blockHash: network.deploymentBlockHash });
  await page.route("**/rpc", async route => {
    const body = route.request().postDataJSON();
    const answer = (item: { id: number; method: string }) => ({ jsonrpc: "2.0", id: item.id, result: item.method === "eth_chainId" ? "0x7a69" : item.method === "eth_call" ? "0x" + "0".repeat(63) + "1" : item.method === "eth_getCode" ? "0x01"
      : item.method === "eth_getBalance" ? "0x" + (10n ** 21n).toString(16) : item.method === "eth_getBlockByNumber" ? { number: "0x2", hash: network.deploymentBlockHash, parentHash: network.deploymentBlockHash, timestamp: "0x6553f100", nonce: "0x0000000000000000", difficulty: "0x0", gasLimit: "0x1c9c380", gasUsed: "0x0", miner: adminWallet, extraData: "0x", transactions: [], baseFeePerGas: "0x1" } : "0x2" });
    await route.fulfill({ json: Array.isArray(body) ? body.map(answer) : answer(body) });
  });
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST") apiWrites.push(path);
    return route.fulfill({ json: path.endsWith("/health/blockchain") ? network
      : path.endsWith("/wallets/me") ? { linked: true, address: adminWallet, chainId: 31337, custodial: false }
      : path.endsWith("/admin/accounts") ? { ledgerTotalWei: "0", ledgerTotalVnd: "0", treasuryWei: "0", contractWei: "0", accounts: [
        { userId: "u2", email: "buyer2@example.test", fullName: "Buyer Two", address: "0x2222222222222222222222222222222222222222", custodial: false, balanceWei: "0", balanceVnd: "0", chainBalanceWei: "0", kycStatus: "NOT_SUBMITTED", verifiedOnChain: false, approvedArbiter: false }] }
      : path.endsWith("/kyc/me") ? { status: "NOT_SUBMITTED", isMock: true, reasonCode: null, maskedStudentNumber: null }
      : [] });
  });
  await page.goto("/");
  const panel = page.getByLabel("Tài khoản người dùng");
  await expect(panel.getByRole("cell", { name: /^Buyer Two/ })).toBeVisible();
  await expect(panel.locator(".admin-credit")).toHaveCount(0);
  await panel.getByRole("button", { name: "Xác minh", exact: true }).click();
  await expect.poll(() => walletCalls).toContain("eth_sendTransaction");
  expect(apiWrites).toEqual([]);
});
