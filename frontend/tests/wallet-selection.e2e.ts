import { test, expect } from "@playwright/test";

test("login requests the linked wallet, respects rejection and allows explicit retry", async ({ page }) => {
  await page.route("**/api/**", route => route.fulfill({ json: route.request().url().includes("/wallets/me") ? { linked: true, address: "0x2222222222222222222222222222222222222222", chainId: 31337 } : route.request().url().includes("/orders") ? [] : { status: "Unavailable" } }));
  await page.addInitScript(() => {
    sessionStorage.setItem("escrow.session", JSON.stringify({ accessToken: "mock-wallet", expiresAt: "2099-01-01T00:00:00Z", user: { id: "wallet-test", fullName: "Wallet test", email: "student@example.test" } }));
    let account = "0x1111111111111111111111111111111111111111";
    let attempts = 0;
    window.ethereum = {
      async request({ method, params }) {
        if (method === "eth_accounts" || method === "eth_requestAccounts") return [account];
        if (method === "eth_chainId") return "0x7a69";
        if (method === "wallet_requestPermissions") {
          if (JSON.stringify(params) !== JSON.stringify([{ eth_accounts: {} }])) throw new Error("Invalid permissions");
          if (++attempts === 1) throw Object.assign(new Error("Rejected"), { code: 4001 });
          account = "0x2222222222222222222222222222222222222222";
          return [{ parentCapability: "eth_accounts" }];
        }
        throw new Error(`Unexpected method: ${method}`);
      }
    };
  });
  await page.goto("/");
  await expect(page.getByRole("alert").filter({ hasText: "từ chối" })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("alert").filter({ hasText: "từ chối" })).toBeVisible();
  await page.getByRole("button", { name: "Đồng bộ ví", exact: true }).click();
  await expect(page.getByText("Ví đã sẵn sàng", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "từ chối" })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("escrow.session")!).accessToken)).toBe("mock-wallet");
});

test("a rejected network change never marks the linked wallet ready", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("escrow.session", JSON.stringify({ accessToken: "network-test", expiresAt: "2099-01-01T00:00:00Z", user: { id: "network", fullName: "Network test", email: "student@gmail.com" } }));
    window.ethereum = { async request({ method }) {
      if (method === "eth_chainId") return "0x1";
      if (method === "eth_accounts") return ["0x1111111111111111111111111111111111111111"];
      if (method === "wallet_switchEthereumChain") throw Object.assign(new Error("Rejected"), { code: 4001 });
      throw new Error(method);
    } };
  });
  await page.route("**/api/**", route => route.fulfill({ json: route.request().url().includes("/wallets/me") ? { linked: true, address: "0x1111111111111111111111111111111111111111", chainId: 31337 } : route.request().url().includes("/orders") ? [] : { status: "Unavailable" } }));
  await page.goto("/");
  await expect(page.getByRole("alert").filter({ hasText: "từ chối" })).toBeVisible();
  await expect(page.getByText("Ví đã sẵn sàng", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Tạo bản nháp", exact: true })).toBeDisabled();
});
