import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { parseEther, sha256, toUtf8Bytes } from "ethers";

const buyer = "0x1111111111111111111111111111111111111111";
const seller = "0x2222222222222222222222222222222222222222";
const arbiter = "0x3333333333333333333333333333333333333333";
const network = { status: "Ready", deploymentId: "trust-test", chainId: "31337", contractAddress: "0x4444444444444444444444444444444444444444", deploymentBlock: 1, deploymentBlockHash: "0x" + "ab".repeat(32), lastIndexedBlock: 2, checkedAt: "2099-01-01T00:00:00Z" };
const text = "1. Phạm vi\nÁp dụng cho mọi đơn.\n\n2. Chấp nhận điều khoản\nSeller chấp nhận trước khi ký quỹ.";
const terms = { version: "2026-11-v1", title: "Điều khoản giao dịch", text, hash: sha256(toUtf8Bytes(text)) };
const draft = { id: "00000000-0000-0000-0000-000000000001", deploymentId: network.deploymentId, buyer, seller, arbiter, amountWei: parseEther("0.01").toString(), description: "Landing page", acceptanceCriteria: "Responsive", deliveryDeadline: 2000000000, reviewWindow: 300, clientReference: "0x" + "11".repeat(32), termsJson: "", termsHash: "", standardTermsVersion: terms.version, createdAt: "2026-01-01T00:00:00Z" };
draft.termsJson = JSON.stringify({ version: 2, standardTermsVersion: terms.version, standardTermsHash: terms.hash, chainId: 31337, contract: network.contractAddress, deploymentId: draft.deploymentId, buyer, seller, arbiter, amountWei: draft.amountWei, description: draft.description, acceptanceCriteria: draft.acceptanceCriteria, deliveryDeadline: draft.deliveryDeadline, reviewWindow: draft.reviewWindow, clientReference: draft.clientReference, feeBps: 100 });
draft.termsHash = sha256(toUtf8Bytes(draft.termsJson));
const parties = { buyer: { fullName: "Buyer Test", maskedEmail: "bu***@example.test" }, seller: { fullName: "Seller Test", maskedEmail: "se***@example.test" }, arbiter: { fullName: "Trọng tài A", maskedEmail: "ar***@example.test" } };

type Options = { account?: string; state?: string | null; arbiters?: { fullName: string; address: string }[]; tamperTerms?: boolean; email?: string; listed?: boolean };
async function fixture(page: Page, options: Options = {}) {
  const account = options.account ?? buyer;
  const posted = { drafts: [] as any[], actions: [] as any[], arbiters: [] as any[] };
  await page.addInitScript(({ email }) => {
    sessionStorage.setItem("escrow.session", JSON.stringify({ accessToken: "trust", expiresAt: "2099-01-01T00:00:00Z", user: { id: "trust", fullName: "Trust test", email } }));
  }, { email: options.email ?? "user@example.test" });
  const view = () => ({ draft, chain: options.state ? { orderId: "1", state: options.state, deliveryHash: null, reviewDeadline: null, buyerRefundWei: "0", sellerNetWei: "0", platformFeeWei: "0" } : null, termsMatch: !!options.state, syncStatus: "Ready", files: [], deliveryFileMatchesChain: false, lastIndexedBlock: 2, checkedAt: "2099-01-01T00:00:00Z", parties });
  await page.route("**/rpc", async route => {
    const body = route.request().postDataJSON();
    const answer = (item: { id: number; method: string }) => ({ jsonrpc: "2.0", id: item.id, result:
      item.method === "eth_chainId" ? "0x7a69" : item.method === "eth_call" ? "0x" + "0".repeat(63) + "1"
      : item.method === "eth_getBlockByNumber" ? { number: "0x2", hash: network.deploymentBlockHash, parentHash: network.deploymentBlockHash, timestamp: "0x6553f100", nonce: "0x0000000000000000", difficulty: "0x0", gasLimit: "0x1c9c380", gasUsed: "0x0", miner: account, extraData: "0x", transactions: [], baseFeePerGas: "0x1" }
      : item.method === "eth_blockNumber" ? "0x2" : "0x0" });
    await route.fulfill({ json: Array.isArray(body) ? body.map(answer) : answer(body) });
  });
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url()), path = url.pathname, method = route.request().method();
    if (path.endsWith("/orders/terms")) return route.fulfill({ json: options.tamperTerms ? { ...terms, text: text + " Đã sửa." } : terms });
    if (path.endsWith("/orders/arbiters")) return route.fulfill({ json: options.arbiters ?? [{ fullName: "Trọng tài A", address: arbiter }, { fullName: "Chính tôi", address: account }] });
    if (path.endsWith("/orders/party-lookup")) {
      const { email } = route.request().postDataJSON();
      return email === "seller@example.test" ? route.fulfill({ json: { fullName: "Seller Test", maskedEmail: "se***@example.test", address: seller } })
        : route.fulfill({ status: 404, json: { code: "PARTY_NOT_FOUND", message: "Không tìm thấy tài khoản có ví với email này.", traceId: "t" } });
    }
    if (path.endsWith("/actions")) { posted.actions.push(route.request().postDataJSON()); return route.fulfill({ json: { transactionHash: "0x" + "12".repeat(32) } }); }
    if (path.endsWith("/admin/arbiters")) { posted.arbiters.push(route.request().postDataJSON()); return route.fulfill({ json: { transactionHash: "0x" + "12".repeat(32) } }); }
    if (path.endsWith("/admin/accounts")) return route.fulfill({ json: { ledgerTotalWei: "0", ledgerTotalVnd: "0", treasuryWei: "0", contractWei: "0", accounts: [
      { userId: "u1", email: "seller2@example.test", fullName: "Trọng tài mới", address: arbiter, custodial: true, balanceWei: "0", balanceVnd: "0", chainBalanceWei: "0", kycStatus: "VERIFIED", verifiedOnChain: true, approvedArbiter: false },
      { userId: "u2", email: "viego.hvnh@gmail.com", fullName: "Admin", address: account, custodial: true, balanceWei: "0", balanceVnd: "0", chainBalanceWei: "0", kycStatus: "VERIFIED", verifiedOnChain: true, approvedArbiter: false }] } });
    if (path.endsWith("/orders") && method === "POST") { posted.drafts.push(route.request().postDataJSON()); return route.fulfill({ status: 201, json: view() }); }
    return route.fulfill({ json: path.endsWith("/health/blockchain") ? network
      : path.endsWith("/wallets/me") ? { linked: true, address: account, chainId: 31337, custodial: true }
      : path.endsWith("/wallets/deposits") ? []
      : path.endsWith("/wallets/account") ? { custodial: true, address: account, balanceWei: parseEther("1").toString(), balanceVnd: "100000000", lockedWei: "0", lockedVnd: "0", vndPerEth: 100000000, entries: [] }
      : path.endsWith("/kyc/me") ? { status: "VERIFIED", isMock: true, reasonCode: null, maskedStudentNumber: null }
      : path.endsWith("/orders") ? (options.listed ? [view()] : []) : path.endsWith("/events") ? [] : view() });
  });
  return posted;
}

test("Buyer finds the Seller by email, picks a listed Arbiter and must tick the terms", async ({ page }) => {
  const posted = await fixture(page);
  await page.goto("/?create=1");
  const save = page.getByRole("button", { name: "Lưu bản nháp", exact: true });
  await expect(page.getByLabel("Ví Seller")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Điều khoản giao dịch" })).toContainText("2. Chấp nhận điều khoản");
  await page.getByLabel("Nội dung công việc").fill("Landing page");
  await expect(page.getByLabel("Tiêu chí nghiệm thu")).toHaveValue(/Mã nguồn chạy được/);
  await expect(save).toBeDisabled();

  await page.getByLabel("Email Seller").fill("nobody@example.test");
  await page.getByRole("button", { name: "Tìm Seller", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Không tìm thấy tài khoản" })).toBeVisible();

  await page.getByLabel("Email Seller").fill("seller@example.test");
  await page.getByRole("button", { name: "Tìm Seller", exact: true }).click();
  await expect(page.locator(".party-found")).toContainText("Seller Test");
  await expect(page.locator(".party-found")).toContainText(seller);

  // The Buyer's own wallet is on the platform list here, but never offered.
  const select = page.locator("select[name=arbiter]");
  await expect(select.locator("option")).toHaveText(["Chọn Arbiter", "Trọng tài A"]);
  await select.selectOption({ label: "Trọng tài A" });
  await expect(save).toBeDisabled();
  await page.getByLabel("Tôi đã đọc và đồng ý", { exact: false }).check();
  await save.click();
  await expect.poll(() => posted.drafts.length).toBe(1);
  expect(posted.drafts[0]).toMatchObject({ sellerEmail: "seller@example.test", arbiter, acceptedTermsVersion: terms.version });
  expect(posted.drafts[0].seller).toBeUndefined();
});

test("changing the Seller email clears the previous match", async ({ page }) => {
  await fixture(page);
  await page.goto("/?create=1");
  await page.getByLabel("Email Seller").fill("seller@example.test");
  await page.getByRole("button", { name: "Tìm Seller", exact: true }).click();
  await expect(page.locator(".party-found")).toBeVisible();
  await page.getByLabel("Email Seller").fill("seller2@example.test");
  await expect(page.locator(".party-found")).toHaveCount(0);
});

test("an empty platform list explains why no draft can be saved", async ({ page }) => {
  await fixture(page, { arbiters: [] });
  await page.goto("/?create=1");
  await expect(page.getByRole("alert").filter({ hasText: "Chưa có Arbiter phù hợp" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Lưu bản nháp", exact: true })).toBeDisabled();
});

test("Seller reads the terms and must tick before accepting", async ({ page }) => {
  const posted = await fixture(page, { account: seller, state: "Created" });
  await page.goto(`/?order=${draft.id}`);
  await expect(page.getByTestId("order-state")).toHaveText("Chờ Seller chấp nhận");
  const panel = page.getByRole("region", { name: "Chấp nhận điều khoản" });
  await expect(panel).toContainText("1.000.000 ₫");
  await expect(panel).toContainText("Trọng tài A");
  await expect(panel).toContainText("1. Phạm vi");
  const accept = page.getByRole("button", { name: "Chấp nhận đơn", exact: true });
  await expect(accept).toBeDisabled();
  await page.getByLabel("Tôi đã đọc và đồng ý với thỏa thuận", { exact: false }).check();
  await accept.click();
  await expect.poll(() => posted.actions).toEqual([{ action: "accept", acceptedTermsVersion: terms.version }]);
});

test("Seller can decline without agreeing to anything", async ({ page }) => {
  const posted = await fixture(page, { account: seller, state: "Created" });
  await page.goto(`/?order=${draft.id}`);
  await page.getByRole("button", { name: "Từ chối đơn", exact: true }).click();
  await expect.poll(() => posted.actions).toEqual([{ action: "cancel" }]);
});

test("wording that differs from the sealed hash cannot be accepted", async ({ page }) => {
  await fixture(page, { account: seller, state: "Created", tamperTerms: true });
  await page.goto(`/?order=${draft.id}`);
  await expect(page.getByRole("alert").filter({ hasText: "không khớp với mã hash" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Chấp nhận đơn", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Tôi đã đọc và đồng ý với thỏa thuận", { exact: false })).toHaveCount(0);
});

test("Buyer waits for the Seller, then funds; both can read the agreed terms", async ({ page }) => {
  await fixture(page, { state: "Created" });
  await page.goto(`/?order=${draft.id}`);
  await expect(page.getByRole("status").filter({ hasText: "Đang chờ Seller đọc và chấp nhận" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ký quỹ 1.000.000 ₫" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Hủy đơn", exact: true })).toBeEnabled();
  await page.getByText("Điều khoản giao dịch của đơn", { exact: true }).click();
  await expect(page.locator(".applied-terms")).toContainText("1. Phạm vi");
  await expect(page.locator(".applied-terms input[type=checkbox]")).toHaveCount(0);
});

test("Buyer can fund or cancel an accepted order", async ({ page }) => {
  const posted = await fixture(page, { state: "Accepted" });
  await page.goto(`/?order=${draft.id}`);
  await expect(page.getByTestId("order-state")).toHaveText("Seller đã chấp nhận");
  await expect(page.getByRole("button", { name: "Ký quỹ 1.000.000 ₫" })).toBeEnabled();
  await page.getByRole("button", { name: "Hủy đơn", exact: true }).click();
  await expect.poll(() => posted.actions).toEqual([{ action: "cancel" }]);
});

test("a cancelled order offers no further actions", async ({ page }) => {
  await fixture(page, { state: "Cancelled" });
  await page.goto(`/?order=${draft.id}`);
  await expect(page.getByTestId("order-state")).toHaveText("Đã hủy");
  await expect(page.getByRole("region", { name: "Đơn đã hủy" })).toContainText("không có khoản tiền nào bị khóa");
  await expect(page.getByRole("button", { name: "Hủy đơn", exact: true })).toHaveCount(0);
});

test("the parties are shown by name, not only by wallet", async ({ page }) => {
  await fixture(page, { state: "Accepted" });
  await page.goto(`/?order=${draft.id}`);
  await page.getByText("Các bên tham gia", { exact: true }).click();
  const summary = page.getByLabel("Tóm tắt thỏa thuận");
  await expect(summary).toContainText("Seller Test · se***@example.test");
  await expect(summary).toContainText("Trọng tài A");
});

test("Admin manages the Arbiter list, its own wallet included", async ({ page }) => {
  const posted = await fixture(page, { email: "viego.hvnh@gmail.com" });
  await page.goto("/");
  const panel = page.getByLabel("Tài khoản người dùng");
  await panel.getByRole("button", { name: "Thêm Arbiter Trọng tài mới" }).click();
  await expect.poll(() => posted.arbiters).toEqual([{ address: arbiter, approved: true }]);
  await expect(panel.getByRole("button", { name: "Thêm Arbiter Admin" })).toBeVisible();
});

test("the only Arbiter on the list is already chosen, and the fee role is disclosed", async ({ page }) => {
  const posted = await fixture(page, { arbiters: [{ fullName: "Admin nền tảng", address: arbiter }] });
  await page.goto("/?create=1");
  await expect(page.locator("select[name=arbiter]")).toHaveValue(arbiter);
  await expect(page.locator(".draft-form")).toContainText("ví nhận phí 1%");
  await page.getByLabel("Nội dung công việc").fill("Landing page");
  await page.getByLabel("Email Seller").fill("seller@example.test");
  await page.getByRole("button", { name: "Tìm Seller", exact: true }).click();
  await page.getByLabel("Tôi đã đọc và đồng ý", { exact: false }).check();
  await page.getByRole("button", { name: "Lưu bản nháp", exact: true }).click();
  await expect.poll(() => posted.drafts[0]?.arbiter).toBe(arbiter);
});

test("Admin rules on a dispute from its Phân xử tab and has no way to create orders", async ({ page }) => {
  const posted = await fixture(page, { account: arbiter, state: "Disputed", email: "viego.hvnh@gmail.com", listed: true });
  await page.goto("/");
  await page.getByRole("navigation", { name: "Chức năng" }).getByRole("button", { name: "Phân xử", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Đơn cần phân xử", exact: true })).toBeVisible();
  await expect(page.getByText("1 đang chờ phân xử", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tạo bản nháp", exact: true })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Vai trò giao dịch" })).toHaveCount(0);
  await page.getByRole("button", { name: `Mở đơn ${draft.description}`, exact: true }).click();
  await page.getByLabel("Phần Seller được hưởng (%)", { exact: true }).fill("70");
  await page.getByRole("button", { name: "Phân xử và thanh toán", exact: true }).click();
  await expect.poll(() => posted.actions).toEqual([{ action: "resolve", sellerShareBps: 7000 }]);
});

test("a create link does not open the draft form for the Admin", async ({ page }) => {
  await fixture(page, { account: arbiter, email: "viego.hvnh@gmail.com" });
  await page.goto("/?create=1");
  await page.getByRole("navigation", { name: "Chức năng" }).getByRole("button", { name: "Phân xử", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tạo giao dịch mới" })).toHaveCount(0);
});

for (const width of [375, 1440]) test(`the draft form and terms fit at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await fixture(page, { account: seller, state: "Created" });
  await page.goto(`/?order=${draft.id}`);
  await expect(page.getByRole("region", { name: "Chấp nhận điều khoản" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `../.artifacts/trust-flow/accept-${width}.png`, fullPage: true });
  await page.goto("/?create=1");
  await expect(page.getByRole("region", { name: "Điều khoản giao dịch" })).toBeVisible();
  await page.getByLabel("Email Seller").fill("seller@example.test");
  await page.getByRole("button", { name: "Tìm Seller", exact: true }).click();
  await expect(page.locator(".party-found")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `../.artifacts/trust-flow/draft-${width}.png`, fullPage: true });
});
