import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const address = "0x1111111111111111111111111111111111111111";
for (const admin of [false, true]) for (const width of [375, 1440]) {
  test(`mocked ${admin ? "admin" : "user"} login prepares wallet and shows its workspace at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const email = admin ? "viego.hvnh@gmail.com" : "buyertest@gmail.com";
    const calls: string[] = [];
    await page.exposeFunction("walletCalled", (method: string) => calls.push(method));
    await page.addInitScript(address => {
      let connected = false;
      let chain = "0x1";
      window.ethereum = { async request({ method }) {
        await (window as any).walletCalled(method);
        if (method === "eth_accounts") return connected ? [address] : [];
        if (method === "eth_requestAccounts") { connected = true; return [address]; }
        if (method === "eth_chainId") return chain;
        if (method === "wallet_switchEthereumChain") { chain = "0x7a69"; return null; }
        throw new Error(`Unexpected method ${method}`);
      } };
    }, address);
    await page.route("**/api/**", route => {
      const path = new URL(route.request().url()).pathname;
      return route.fulfill({ json: path.endsWith("/auth/login") ? { accessToken: "mock-role", expiresAt: "2099-01-01T00:00:00Z", user: { id: "role-test", fullName: admin ? "Quản trị viên" : "Minh Kiên", email } }
        : path.endsWith("/wallets/me") ? { linked: true, address, chainId: 31337 }
        : path.endsWith("/orders") ? [] : { status: "Unavailable" } });
    });
    await page.goto("/");
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Mật khẩu", { exact: true }).fill("mock-password");
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await expect(page.getByText("Ví đã sẵn sàng", { exact: true })).toBeVisible();
    expect(calls).toContain("eth_requestAccounts");
    expect(calls).toContain("wallet_switchEthereumChain");
    expect(calls).not.toContain("personal_sign");
    expect(calls).not.toContain("eth_sendTransaction");
    const nav = page.getByRole("navigation", { name: "Chức năng" });
    await expect(nav.getByRole("button", { name: "Quản trị", exact: true })).toHaveCount(admin ? 1 : 0);
    await expect(nav.getByRole("button", { name: "Đơn hàng", exact: true })).toHaveCount(admin ? 0 : 1);
    await expect(page.getByRole("heading", { name: admin ? "Quản trị xác minh" : "Đơn hàng của bạn", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await mkdir("test-results/screenshots", { recursive: true });
    await page.screenshot({ path: `test-results/screenshots/${admin ? "admin" : "user"}-workspace-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Đăng nhập", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation")).toHaveCount(0);
  });
}

test("mocked wallet balance and gas price are displayed after login", async ({ page }) => {
  await page.addInitScript(address => {
    sessionStorage.setItem("escrow.session", JSON.stringify({ accessToken: "funds", expiresAt: "2099-01-01T00:00:00Z", user: { id: "funds", fullName: "Student", email: "student@gmail.com" } }));
    window.ethereum = { async request({ method }) { return method === "eth_chainId" ? "0x7a69" : [address]; } };
  }, address);
  await page.route("**/api/**", route => route.fulfill({ json: route.request().url().includes("/wallets/me") ? { linked: true, address, chainId: 31337 } : route.request().url().includes("/orders") ? [] : { status: "Ready" } }));
  await page.route("**/rpc", route => {
    const input = route.request().postDataJSON();
    const answer = (r: { id: number; method: string }) => ({ jsonrpc: "2.0", id: r.id, result: r.method === "eth_chainId" ? "0x7a69" : r.method === "eth_getBalance" ? "0xde0b6b3a7640000" : r.method === "eth_gasPrice" ? "0x3b9aca00" : { timestamp: "0x6553f100" } });
    return route.fulfill({ json: Array.isArray(input) ? input.map(answer) : answer(input) });
  });
  await page.goto("/");
  await expect(page.getByText("1.0 ETH", { exact: true })).toBeVisible();
  await expect(page.getByText("1.0 Gwei", { exact: true })).toBeVisible();
});
