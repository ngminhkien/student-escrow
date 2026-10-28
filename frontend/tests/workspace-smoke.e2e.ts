import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const session = { accessToken: "mock-token", expiresAt: "2099-01-01T00:00:00Z", user: { id: "mock-user", fullName: "Sinh viên thử nghiệm", email: "student@example.test" } };
const order = (index: number) => ({ draft: { id: `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`, description: `Website ${index}`, acceptanceCriteria: "Responsive", amountWei: "10000000000000000", buyer: "0x1111111111111111111111111111111111111111", seller: "0x2222222222222222222222222222222222222222", arbiter: "0x3333333333333333333333333333333333333333", deliveryDeadline: 2000000000, reviewWindow: 300 }, chain: null, syncStatus: "Ready", files: [] });
for (const width of [375, 1440]) test(`mocked workspace navigation and local pagination at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const offsets: string[] = [];
  await page.addInitScript(() => { window.ethereum = { async request({ method }) { return method === "eth_chainId" ? "0x7a69" : ["0x1111111111111111111111111111111111111111"]; } }; });
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    let json: unknown = {};
    if (url.pathname.endsWith("/health/blockchain")) json = { status: "Unavailable" };
    else if (url.pathname.endsWith("/wallets/me")) json = { linked: true, address: "0x1111111111111111111111111111111111111111", chainId: 31337 };
    else if (url.pathname.endsWith("/kyc/me")) json = { status: "NOT_SUBMITTED", isMock: true };
    else if (url.pathname.endsWith("/auth/login")) json = session;
    else if (url.pathname.endsWith("/orders")) { const skip = url.searchParams.get("skip") ?? "0"; offsets.push(skip); json = skip === "0" ? Array.from({ length: 50 }, (_, i) => order(i + 1)) : [order(51)]; }
    await route.fulfill({ json });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Đăng nhập", exact: true })).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill("student@example.test");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("mock-password");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Đơn hàng của bạn" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tạo bản nháp", exact: true })).toBeDisabled();
  await page.getByLabel("Tìm trong các đơn đã tải").fill("no-such-work");
  await expect(page.getByRole("heading", { name: "Không có đơn phù hợp bộ lọc" })).toBeVisible();
  await page.getByRole("button", { name: "Xóa bộ lọc" }).click();
  await page.getByRole("button", { name: "Xem thêm 50 đơn" }).click();
  await expect(page.getByText("Website 51", { exact: true })).toBeVisible();
  expect(offsets).toContain("50");
  expect(offsets.every(value => value === "0" || value === "50")).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await mkdir("test-results/screenshots", { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `test-results/screenshots/orders-${width}.png`, fullPage: false });
  await page.getByRole("button", { name: "Tài khoản & ví", exact: true }).click();
  await expect(page.getByLabel("Họ tên demo")).toBeVisible();
  await expect(page.getByRole("button", { name: "Nộp KYC demo", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `test-results/screenshots/account-${width}.png`, fullPage: false });
  await expect(page.getByRole("button", { name: "Quản trị", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Đăng nhập", exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("escrow.session"))).toBeNull();
});

test("mocked pending protected read is discarded after logout", async ({ page }) => {
  await page.addInitScript(value => sessionStorage.setItem("escrow.session", JSON.stringify(value)), session);
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/**", async route => {
    if (new URL(route.request().url()).pathname.endsWith("/orders")) { await wait; await route.fulfill({ json: [order(999)] }).catch(() => {}); }
    else await route.fulfill({ json: { status: "Unavailable", linked: false } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  release();
  await expect(page.getByRole("heading", { name: "Đăng nhập", exact: true })).toBeVisible();
  await expect(page.getByText("Website 999", { exact: true })).toHaveCount(0);
});

test("mocked download refuses bytes that disagree with recorded SHA-256", async ({ page }) => {
  await page.route("**/api/**", route => route.fulfill({ json: { status: "Unavailable" } }));
  await page.goto("/");
  await page.route("**/api/orders/file-order/files/file-id", route => route.fulfill({ body: Buffer.from("corrupt"), contentType: "application/octet-stream" }));
  await page.evaluate(async value => {
    // Vite serves source modules; this isolated component harness exercises actual download guards.
    const reactPath = "/node_modules/.vite/deps/react.js";
    const domPath = "/node_modules/.vite/deps/react-dom_client.js";
    const filesPath = "/src/features/orders/OrderFiles.tsx";
    const { default: React } = await import(/* @vite-ignore */ reactPath);
    const { default: { createRoot } } = await import(/* @vite-ignore */ domPath);
    const { default: Files } = await import(/* @vite-ignore */ filesPath);
    const host = document.createElement("div"); host.id = "file-harness"; document.body.append(host);
    const view = { draft: { id: "file-order", deploymentId: "old" }, chain: null, syncStatus: "Stale", termsMatch: false, files: [{ id: "file-id", kind: "product", fileName: "safe.zip", length: 7, sha256: "0x" + "0".repeat(64) }] };
    createRoot(host).render(React.createElement(Files, { session: value, account: "", canSign: false, network: { status: "Unavailable" }, chainTime: 0, busy: false, view, onRefresh() {}, onHashMismatch() {}, run: async (_: string, action: () => Promise<void>) => { try { await action(); } catch (error) { const alert = document.createElement("p"); alert.role = "alert"; alert.textContent = String(error); host.append(alert); } } }));
  }, session);
  await page.getByRole("button", { name: "Tải safe.zip", exact: true }).click();
  await expect(page.locator("#file-harness [role=alert]")).toContainText("hash file tải xuống không khớp");
});
