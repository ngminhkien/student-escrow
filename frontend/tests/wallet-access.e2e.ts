import { test, expect } from "@playwright/test";

const address = "0x1111111111111111111111111111111111111111";
for (const admin of [false, true]) for (const failure of ["wrong", "disconnected", "network"] as const) {
  test(`mocked ${admin ? "admin" : "user"} controls lock on ${failure} wallet and recover with the linked wallet`, async ({ page }) => {
    await page.addInitScript(({ address, admin }) => {
      sessionStorage.setItem("escrow.session", JSON.stringify({ accessToken: "access-test", expiresAt: "2099-01-01T00:00:00Z", user: { id: "access-test", fullName: "Test Student", email: admin ? "viego.hvnh@gmail.com" : "student@gmail.com" } }));
      let account = address;
      let chain = "0x7a69";
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      (window as any).__setWallet = (mode: string) => {
        account = mode === "wrong" ? "0x2222222222222222222222222222222222222222" : mode === "disconnected" ? "" : address;
        chain = mode === "network" ? "0x1" : "0x7a69";
        listeners.accountsChanged?.forEach(callback => callback(account ? [account] : []));
        listeners.chainChanged?.forEach(callback => callback(chain));
      };
      window.ethereum = {
        on(event, callback) { (listeners[event] ??= []).push(callback); },
        removeListener(event, callback) { listeners[event] = (listeners[event] ?? []).filter(value => value !== callback); },
        async request({ method }) {
          if (method === "eth_accounts") return account ? [account] : [];
          if (method === "eth_chainId") return chain;
          throw Object.assign(new Error("Rejected"), { code: 4001 });
        }
      };
    }, { address, admin });
    await page.route("**/api/**", route => {
      const path = new URL(route.request().url()).pathname;
      return route.fulfill({ json: path.endsWith("/wallets/me") ? { linked: true, address, chainId: 31337 }
        : path.endsWith("/kyc/me") ? { status: "NOT_SUBMITTED", isMock: true }
        : path.endsWith("/orders") ? [] : { status: "Ready", deploymentId: "test-deploy", contractAddress: "0x4444444444444444444444444444444444444444" } });
    });
    await page.route("**/rpc", route => {
      const input = route.request().postDataJSON();
      const answer = (r: any) => ({ jsonrpc: "2.0", id: r.id, result: r.method === "eth_chainId" ? "0x7a69" : r.method === "eth_getBalance" ? "0xde0b6b3a7640000" : r.method === "eth_gasPrice" ? "0x3b9aca00" : r.method === "eth_call" ? "0x" + "0".repeat(64) : { timestamp: "0x6553f100" } });
      return route.fulfill({ json: Array.isArray(input) ? input.map(answer) : answer(input) });
    });
    await page.goto("/");
    await expect(page.getByText("Ví đã sẵn sàng", { exact: true })).toBeVisible();
    if (admin) await page.getByLabel("Địa chỉ ví cần quản lý").fill("0x3333333333333333333333333333333333333333");
    const action = page.getByRole("button", { name: admin ? "Tra cứu" : "Tải lại đơn", exact: true });
    await expect(action).toBeEnabled();
    await page.evaluate(failure => (window as any).__setWallet(failure), failure);
    await expect(page.locator("#wallet-access-warning")).toContainText(failure === "wrong" ? "MetaMask đang kết nối sai ví" : failure === "network" ? "MetaMask đang kết nối sai mạng" : "Chưa kết nối ví MetaMask");
    await expect(page.locator("#wallet-access-warning")).toContainText(address);
    await expect(action).toBeDisabled();
    await expect(page.getByRole("button", { name: "Đăng xuất", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Đồng bộ ví", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Tài khoản & ví", exact: true }).click();
    await expect(page.getByRole("button", { name: "Nộp KYC demo", exact: true })).toBeDisabled();
    await expect(page.getByLabel("Họ tên demo")).toBeDisabled();
    await page.evaluate(() => (window as any).__setWallet("correct"));
    await expect(page.getByText("Ví đã sẵn sàng", { exact: true })).toBeVisible();
    await expect(page.locator("#wallet-access-warning")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Nộp KYC demo", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: admin ? "Quản trị" : "Đơn hàng", exact: true }).click();
    if (admin) await page.getByLabel("Địa chỉ ví cần quản lý").fill("0x3333333333333333333333333333333333333333");
    await expect(page.getByRole("button", { name: admin ? "Tra cứu" : "Tải lại đơn", exact: true })).toBeEnabled();
  });
}
