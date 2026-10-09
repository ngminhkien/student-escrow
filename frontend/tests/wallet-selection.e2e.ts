import { test, expect } from "@playwright/test";

test("connected wallet can be changed through MetaMask permissions without changing app session", async ({ page }) => {
  await page.route("**/api/health/blockchain", route => route.fulfill({ json: { status: "Unavailable" } }));
  await page.addInitScript(() => {
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
  const connected = page.locator(".connection .mono[title]");
  await expect(connected).toHaveAttribute("title", "0x1111111111111111111111111111111111111111");
  await page.getByRole("button", { name: "Đổi ví MetaMask", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("từ chối");
  await expect(connected).toHaveAttribute("title", "0x1111111111111111111111111111111111111111");
  await page.getByRole("button", { name: "Đổi ví MetaMask", exact: true }).click();
  await expect(connected).toHaveAttribute("title", "0x2222222222222222222222222222222222222222");
  await expect(page.getByRole("heading", { name: "Đăng nhập", exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("escrow.session"))).toBeNull();
});
