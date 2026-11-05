import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEPOSIT_MAX_VND, DEPOSIT_MIN_VND, parseDepositVnd, WEI_PER_VND } from "../src/domain/money";

const account = "0x1111111111111111111111111111111111111111";
const network = { status: "Ready", deploymentId: "deposit-test", chainId: "31337", contractAddress: "0x4444444444444444444444444444444444444444", deploymentBlock: 1, deploymentBlockHash: "0x" + "ab".repeat(32), syncedBlock: 1, latestBlock: 1, message: "" };
const wei = (vnd: number) => (BigInt(vnd) * WEI_PER_VND).toString();
const payoutHash = "0x" + "c".repeat(64);
const deposit = (amountVnd: number, status = "Pending") => ({ id: "abcdef12-0000-4000-8000-000000000001", amountVnd, amountWei: wei(amountVnd), status, gateway: "mock", gatewayTransactionId: null, createdAt: "2026-11-04T10:00:00Z", expiresAt: "2026-11-04T10:15:00Z", completedAt: null, payoutAddress: null as string | null, payoutStatus: null as string | null, payoutTransactionHash: null as string | null });
type Deposit = ReturnType<typeof deposit>;

async function fixture(page: Page, options: { custodial?: boolean; unlinked?: boolean; payout?: "Queued" | "Sending" | "Sent"; open?: Deposit[]; failCreate?: { status: number; code: string; message: string } } = {}) {
  const custodial = options.custodial ?? true;
  const state = { balance: 0, deposits: options.open ?? [] as Deposit[] };
  const creates: { amountVnd: number; reference: string }[] = [];
  const payments: { outcome: string }[] = [];
  const cancels: string[] = [];
  const retries: string[] = [];
  const sent = (item: Deposit) => ({ ...item, payoutStatus: "Sent", payoutTransactionHash: payoutHash });
  await page.addInitScript(() => {
    sessionStorage.setItem("escrow.session", JSON.stringify({ accessToken: "deposit", expiresAt: "2099-01-01T00:00:00Z", user: { id: "deposit", fullName: "Deposit test", email: "buyer@example.test" } }));
    (window as any).ethereum = { isMetaMask: true, on() {}, removeListener() {}, request: async ({ method }: { method: string }) => { if (method === "eth_accounts") return []; if (method === "eth_chainId") return "0x7a69"; throw new Error("MetaMask must not be used"); } };
  });
  await page.route("**/rpc", async route => {
    const body = route.request().postDataJSON();
    const answer = (item: { id: number; method: string }) => ({ jsonrpc: "2.0", id: item.id, result: item.method === "eth_chainId" ? "0x7a69" : item.method === "eth_call" ? "0x" + "0".repeat(63) + "1" : "0x2" });
    await route.fulfill({ json: Array.isArray(body) ? body.map(answer) : answer(body) });
  });
  const replace = (next: Deposit): Deposit => { state.deposits = [next, ...state.deposits.filter(item => item.id !== next.id)]; return next; };
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path.endsWith("/wallets/deposits") && method === "POST") {
      const body = route.request().postDataJSON();
      creates.push(body);
      if (options.failCreate) return route.fulfill({ status: options.failCreate.status, json: { ...options.failCreate, traceId: "t" } });
      return route.fulfill({ json: replace({ ...deposit(body.amountVnd), payoutAddress: custodial && !options.payout ? null : account }) });
    }
    if (path.endsWith("/mock-payment")) {
      const body = route.request().postDataJSON();
      payments.push(body);
      const current = state.deposits[0];
      if (current.payoutAddress) {
        if (custodial && body.outcome === "Succeeded") state.balance += current.amountVnd;
        const paid = { ...current, status: body.outcome, payoutStatus: options.payout ?? "Sent" };
        return route.fulfill({ json: replace(paid.payoutStatus === "Sent" ? sent(paid) : paid) });
      }
      if (body.outcome === "Succeeded") state.balance += current.amountVnd;
      return route.fulfill({ json: replace({ ...current, status: body.outcome }) });
    }
    if (path.endsWith("/payout")) { retries.push(path); return route.fulfill({ json: replace(sent(state.deposits[0])) }); }
    if (path.endsWith("/cancel")) { cancels.push(path); return route.fulfill({ json: replace({ ...state.deposits[0], status: "Cancelled" }) }); }
    return route.fulfill({ json: path.endsWith("/health/blockchain") ? network
      : path.endsWith("/wallets/me") ? options.unlinked ? { linked: false, address: null, chainId: null } : { linked: true, address: account, chainId: 31337, custodial }
      : path.endsWith("/wallets/deposits") ? state.deposits
      : path.endsWith("/wallets/account") ? { custodial, address: account, balanceWei: wei(state.balance), balanceVnd: String(state.balance), lockedWei: "0", lockedVnd: "0", vndPerEth: 100000000, entries: state.balance ? [{ id: "e1", type: "GatewayDeposit", amountWei: wei(state.balance), amountVnd: String(state.balance), balanceAfterWei: wei(state.balance), orderId: null, transactionHash: null, note: null, createdAt: "2026-11-04T10:01:00Z" }] : [] }
      : path.endsWith("/kyc/me") ? { status: "VERIFIED", isMock: true, reasonCode: null, maskedStudentNumber: "DEMO-***456" }
      : path.endsWith("/orders") ? [] : [] });
  });
  return { state, creates, payments, cancels, retries };
}

async function open(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Tài khoản & ví" }).click();
  return page.getByRole("region", { name: "Nạp tiền" });
}
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("a successful payment raises the balance and shows up in both histories", async ({ page }) => {
  const { creates, payments } = await fixture(page);
  const panel = await open(page);
  await expect(page.getByLabel("Lịch sử số dư")).toContainText("Nạp tiền ở mục phía trên");
  await panel.getByLabel("Số tiền (VND)").fill("2.500.000");
  await panel.getByRole("button", { name: "Tiếp tục" }).click();
  await expect.poll(() => creates.length).toBe(1);
  expect(creates[0].amountVnd).toBe(2500000);
  expect(creates[0].reference).toMatch(/^[0-9a-f-]{36}$/);

  const gateway = panel.getByRole("group", { name: "Cổng thanh toán giả lập" });
  await expect(gateway).toContainText("không có tiền thật");
  await expect(gateway.getByTestId("deposit-amount")).toHaveText("2.500.000 ₫");
  await expect(gateway).toContainText("ABCDEF12");
  await expect(page.getByTestId("ledger-balance")).toContainText("0 ₫");

  await gateway.getByRole("button", { name: "Thanh toán thành công" }).click();
  await expect.poll(() => payments).toEqual([{ outcome: "Succeeded" }]);
  await expect(panel.locator(".deposit-result")).toHaveText("Đã nạp 2.500.000 ₫ vào số dư.");
  await expect(page.getByTestId("ledger-balance")).toContainText("2.500.000 ₫");
  await expect(page.getByTestId("header-balance")).toHaveText("2.500.000 ₫");
  await expect(page.getByLabel("Lịch sử số dư").getByText("Nạp tiền qua cổng")).toBeVisible();
  await expect(panel.locator(".deposit-history")).toContainText("Thành công");
  // The form is back for the next deposit.
  await expect(panel.getByLabel("Số tiền (VND)")).toHaveValue("");
});

test("a ledger deposit shows the transaction that put the ETH on chain", async ({ page }) => {
  await fixture(page, { payout: "Sent" });
  const panel = await open(page);
  await panel.getByLabel("Số tiền (VND)").fill("250000");
  await panel.getByRole("button", { name: "Tiếp tục" }).click();
  await panel.getByRole("button", { name: "Thanh toán thành công" }).click();
  await expect(panel.locator(".deposit-result")).toContainText("Đã nạp 250.000 ₫ vào số dư.");
  await expect(panel.locator(".deposit-result")).toContainText(payoutHash);
  await expect(page.getByTestId("ledger-balance")).toContainText("250.000 ₫");
  await expect(panel.locator(".deposit-history")).toContainText("Thành công");
});

test("a failed payment keeps the balance and allows another try", async ({ page }) => {
  const { payments } = await fixture(page, { open: [deposit(500000)] });
  const panel = await open(page);
  await panel.getByRole("button", { name: "Thanh toán thất bại" }).click();
  await expect.poll(() => payments).toEqual([{ outcome: "Failed" }]);
  await expect(panel.locator(".deposit-result")).toContainText("Số dư không thay đổi");
  await expect(page.getByTestId("ledger-balance")).toContainText("0 ₫");
  await expect(panel.locator(".deposit-history")).toContainText("Thất bại");
  await expect(panel.getByRole("button", { name: "Tiếp tục" })).toBeVisible();
});

test("an open request resumes after reload and can be cancelled", async ({ page }) => {
  const { cancels } = await fixture(page, { open: [deposit(500000)] });
  const panel = await open(page);
  await expect(panel.getByTestId("deposit-amount")).toHaveText("500.000 ₫");
  await expect(panel.getByLabel("Số tiền (VND)")).toHaveCount(0);
  await panel.getByRole("button", { name: "Hủy yêu cầu" }).click();
  await expect.poll(() => cancels.length).toBe(1);
  await expect(panel.locator(".deposit-history")).toContainText("Đã hủy");
  await expect(panel.getByLabel("Số tiền (VND)")).toBeVisible();
});

test("amounts outside the limits never reach the API; presets fill the form", async ({ page }) => {
  const { creates } = await fixture(page);
  const panel = await open(page);
  const input = panel.getByLabel("Số tiền (VND)");
  await input.fill("9.999");
  await panel.getByRole("button", { name: "Tiếp tục" }).click();
  await expect(panel.getByRole("alert")).toContainText("từ 10.000 ₫ đến 50.000.000 ₫");
  await input.fill("abc");
  await panel.getByRole("button", { name: "Tiếp tục" }).click();
  await expect(panel.getByRole("alert")).toContainText("số nguyên dương");
  expect(creates).toEqual([]);
  await panel.getByRole("group", { name: "Chọn nhanh số tiền" }).getByRole("button", { name: "500.000 ₫" }).click();
  await expect(input).toHaveValue("500000");
});

test("a retry after a server refusal reuses the reference; a new amount does not", async ({ page }) => {
  const { creates } = await fixture(page, { failCreate: { status: 409, code: "TOO_MANY_OPEN_DEPOSITS", message: "Bạn có quá nhiều yêu cầu nạp đang chờ." } });
  const panel = await open(page);
  await panel.getByLabel("Số tiền (VND)").fill("100000");
  await panel.getByRole("button", { name: "Tiếp tục" }).click();
  await expect(panel.getByRole("alert")).toContainText("quá nhiều yêu cầu");
  await panel.getByRole("button", { name: "Tiếp tục" }).click();
  await expect.poll(() => creates.length).toBe(2);
  expect(creates[1].reference).toBe(creates[0].reference);
  await panel.getByLabel("Số tiền (VND)").fill("200000");
  await panel.getByRole("button", { name: "Tiếp tục" }).click();
  await expect.poll(() => creates.length).toBe(3);
  expect(creates[2].reference).not.toBe(creates[0].reference);
});

test("an account on its own wallet receives ETH on chain and has no ledger", async ({ page }) => {
  const { payments } = await fixture(page, { custodial: false, payout: "Sent" });
  const panel = await open(page);
  await expect(panel).toContainText(account);
  await expect(panel).toContainText("không qua sổ cái");
  await panel.getByLabel("Số tiền (VND)").fill("250000");
  await panel.getByRole("button", { name: "Tiếp tục" }).click();
  const gateway = panel.getByRole("group", { name: "Cổng thanh toán giả lập" });
  await expect(gateway).toContainText("0.0025 ETH");
  await expect(gateway).toContainText(account);
  await gateway.getByRole("button", { name: "Thanh toán thành công" }).click();
  await expect.poll(() => payments).toEqual([{ outcome: "Succeeded" }]);
  await expect(panel.locator(".deposit-result")).toContainText("Đã gửi 0.0025 ETH vào ví của bạn");
  await expect(panel.locator(".deposit-result")).toContainText(payoutHash);
  await expect(panel.locator(".deposit-history")).toContainText("Đã gửi vào ví");
  await expect(page.getByLabel("Lịch sử số dư")).toHaveCount(0);
  await expect(page.getByTestId("ledger-balance")).toHaveCount(0);
});

test("a payment whose ETH could not be sent offers a retry", async ({ page }) => {
  const { retries } = await fixture(page, { custodial: false, payout: "Queued" });
  const panel = await open(page);
  await panel.getByLabel("Số tiền (VND)").fill("250000");
  await panel.getByRole("button", { name: "Tiếp tục" }).click();
  await panel.getByRole("button", { name: "Thanh toán thành công" }).click();
  await expect(panel.getByRole("alert")).toContainText("chưa gửi được ETH");
  await expect(panel.locator(".deposit-history")).toContainText("Chờ gửi ETH");
  await panel.getByRole("button", { name: "Gửi lại ETH" }).click();
  await expect.poll(() => retries.length).toBe(1);
  await expect(panel.locator(".deposit-result")).toContainText("Đã gửi 0.0025 ETH");
  await expect(panel.getByRole("button", { name: "Gửi lại ETH" })).toHaveCount(0);
});

test("a payout with an unknown outcome is never offered for resending", async ({ page }) => {
  await fixture(page, { custodial: false, payout: "Sending" });
  const panel = await open(page);
  await panel.getByLabel("Số tiền (VND)").fill("250000");
  await panel.getByRole("button", { name: "Tiếp tục" }).click();
  await panel.getByRole("button", { name: "Thanh toán thành công" }).click();
  await expect(panel.getByRole("alert")).toContainText("không tự gửi lại");
  await expect(panel.locator(".deposit-history")).toContainText("Cần kiểm tra");
  await expect(panel.getByRole("button", { name: "Gửi lại ETH" })).toHaveCount(0);
});

test("an unlinked MetaMask account is told to link first and has no deposit panel", async ({ page }) => {
  await fixture(page, { custodial: false, unlinked: true });
  await page.goto("/");
  await page.getByRole("button", { name: "Tài khoản & ví" }).click();
  await expect(page.getByRole("heading", { name: "Liên kết ví" })).toBeVisible();
  await expect(page.getByText("nạp được ETH vào ví")).toBeVisible();
  await expect(page.getByRole("region", { name: "Nạp tiền" })).toHaveCount(0);
});

test("the wallet address and transaction hash fit a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await fixture(page, { custodial: false, open: [{ ...deposit(100000, "Succeeded"), id: "abcdef12-0000-4000-8000-000000000004", payoutAddress: account, payoutStatus: "Sent", payoutTransactionHash: payoutHash }, { ...deposit(50000000), payoutAddress: account }] });
  const panel = await open(page);
  await expect(panel.getByRole("group", { name: "Cổng thanh toán giả lập" })).toContainText(account);
  await expect(panel.locator(".deposit-history")).toContainText(payoutHash);
  expect(await fits(page)).toBe(true);
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "../.artifacts/deposit/self-held-375.png", fullPage: true });
});

for (const width of [375, 1440]) test(`the deposit panel fits at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await fixture(page, { open: [deposit(50000000), { ...deposit(100000, "Succeeded"), id: "abcdef12-0000-4000-8000-000000000002" }, { ...deposit(100000, "Failed"), id: "abcdef12-0000-4000-8000-000000000003" }] });
  const panel = await open(page);
  await expect(panel.getByRole("group", { name: "Cổng thanh toán giả lập" })).toBeVisible();
  expect(await fits(page)).toBe(true);
  // An amount broken across two lines is easy to misread.
  const amount = panel.locator(".deposit-history td.amount").first();
  await expect(amount).toHaveText("50.000.000 ₫");
  expect(await amount.evaluate(cell => { const range = document.createRange(); range.selectNodeContents(cell); return range.getClientRects().length; })).toBe(1);
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `../.artifacts/deposit/gateway-${width}.png`, fullPage: true });
  await panel.getByRole("button", { name: "Hủy yêu cầu" }).click();
  await expect(panel.getByLabel("Số tiền (VND)")).toBeVisible();
  expect(await fits(page)).toBe(true);
  await page.screenshot({ path: `../.artifacts/deposit/form-${width}.png`, fullPage: true });
});

test("parseDepositVnd follows the server's limits", () => {
  expect(parseDepositVnd("10.000")).toBe(DEPOSIT_MIN_VND);
  expect(parseDepositVnd("50,000,000")).toBe(DEPOSIT_MAX_VND);
  for (const bad of ["9999", "50000001", "0", "-10000", "1e5", "", "abc", "99999999999999999999999"]) expect(() => parseDepositVnd(bad)).toThrow();
  const server = readFileSync(resolve("../backend/StudentEscrow.Application/Wallets/DepositContracts.cs"), "utf8");
  expect(server).toContain("MinVnd = 10_000;");
  expect(server).toContain("MaxVnd = 50_000_000;");
});

test("the webhook secret file stays out of git", () => {
  expect(readFileSync(resolve("../.gitignore"), "utf8")).toMatch(/^\/\.runtime\/$/m);
});
