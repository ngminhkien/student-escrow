import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

const account = "0x1111111111111111111111111111111111111111";
const seller = "0x2222222222222222222222222222222222222222";
const arbiter = "0x3333333333333333333333333333333333333333";
const network = { status: "Ready", chainId: "31337", deploymentId: "chat", deploymentBlock: 1, deploymentBlockHash: "0x" + "ab".repeat(32), contractAddress: "0x4444444444444444444444444444444444444444", abi: [], rpcUrl: "/rpc" };
const id = "00000000-0000-0000-0000-000000000007";
const draft = { id, deploymentId: network.deploymentId, buyer: account, seller, arbiter, description: "Làm trang web", acceptanceCriteria: "Chạy được", amountWei: "10000000000000000", deliveryDeadline: 4102444800, reviewWindow: 86400, clientReference: "0x" + "cd".repeat(32), termsHash: "0x" + "ef".repeat(32), termsJson: "{}", standardTermsVersion: "2026-11-05", createdAt: "2026-11-05T00:00:00Z" };
const view = (state: string) => ({ draft, chain: { orderId: "1", state, sellerNetWei: "0", platformFeeWei: "0", buyerRefundWei: "0" }, termsMatch: true, syncStatus: "Ready", lastIndexedBlock: 1, checkedAt: "2026-11-05T00:00:00Z", files: [], deliveryFileMatchesChain: false,
  parties: { buyer: { fullName: "Bên Mua", email: "bu***@x.y" }, seller: { fullName: "Bên Bán", email: "se***@x.y" }, arbiter: { fullName: "Trọng Tài", email: "ar***@x.y" } } });
const message = (seq: number, mine: boolean, text: string) => ({ seq, senderRole: mine ? "Buyer" : "Seller", mine, text, file: null, chainBlock: seq * 10, createdAt: new Date(Date.UTC(2026, 10, 5, 8, seq)).toISOString() });

type Chat = { role: string; state: string; canSend: boolean; messages: ReturnType<typeof message>[]; events: { name: string; blockNumber: number; logIndex: number }[] };

async function open(page: Page, chat: Chat, options: { wallet?: string; fail?: () => boolean } = {}) {
  const asks: string[] = [];
  const posted: unknown[] = [];
  await page.addInitScript(({ wallet }) => {
    sessionStorage.setItem("escrow.session", JSON.stringify({ accessToken: "chat", expiresAt: "2099-01-01T00:00:00Z", user: { id: "user", fullName: "Người dùng", email: "user@example.test" } }));
    (window as any).ethereum = { async request({ method }: { method: string }) {
      if (method === "eth_chainId") return "0x7a69";
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [wallet];
      throw new Error(`Unexpected wallet request ${method}`);
    } };
  }, { wallet: options.wallet ?? account });
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith(`/orders/${id}/chat`)) {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        posted.push(body);
        const saved = message(chat.messages.length + 1, true, body.text);
        chat.messages.push(saved);
        return route.fulfill({ json: saved });
      }
      asks.push(url.search);
      if (options.fail?.()) return route.fulfill({ status: 500, json: { code: "X", message: "Lỗi" } });
      const after = Number(url.searchParams.get("afterSeq") ?? 0);
      return route.fulfill({ json: { role: chat.role, state: chat.state, canSend: chat.canSend, latestSeq: chat.messages.length, messages: chat.messages.filter(item => item.seq > after), events: chat.events } });
    }
    if (path.endsWith("/chat/read")) return route.fulfill({ status: 204 });
    if (path.endsWith("/chat/unread")) return route.fulfill({ json: [] });
    return route.fulfill({ json: path.endsWith("/health/blockchain") ? network : path.endsWith("/wallets/me") ? { linked: true, address: options.wallet ?? account, chainId: 31337, custodial: false, kycStatus: "VERIFIED" }
      : path.endsWith("/orders") ? [view(chat.state)] : path.endsWith("/arbiters") || path.endsWith("/events") ? [] : view(chat.state) });
  });
  await page.route("**/rpc", route => {
    const input = route.request().postDataJSON();
    const answer = (r: any) => ({ jsonrpc: "2.0", id: r.id, result: r.method === "eth_chainId" ? "0x7a69" : "0x0" });
    return route.fulfill({ json: Array.isArray(input) ? input.map(answer) : answer(input) });
  });
  await page.goto(`/?order=${id}`);
  return { asks, posted };
}

test("the parties see messages and verified chain events in one thread, and new messages arrive by polling", async ({ page }) => {
  const chat: Chat = { role: "Buyer", state: "Funded", canSend: true, messages: [message(1, true, "Chào bạn"), message(2, false, "Chào, mình nhận việc")],
    events: [{ name: "Deposited", blockNumber: 15, logIndex: 0 }, { name: "PayoutDeferred", blockNumber: 16, logIndex: 0 }] };
  const { asks } = await open(page, chat);
  const log = page.getByRole("log", { name: "Tin nhắn" });
  await expect(log).toContainText("Chào bạn");
  await expect(log).toContainText("Bên Bán · Seller");
  await expect(log).toContainText("Buyer đã ký quỹ");
  await expect(log).not.toContainText("PayoutDeferred");
  // Block 15 falls between the message anchored at block 10 and the one at block 20, whatever the clocks say.
  const thread = (await log.innerText());
  expect(thread.indexOf("Chào bạn")).toBeLessThan(thread.indexOf("Buyer đã ký quỹ"));
  expect(thread.indexOf("Buyer đã ký quỹ")).toBeLessThan(thread.indexOf("Chào, mình nhận việc"));

  chat.messages.push(message(3, false, "Tin mới đến"));
  await expect(log).toContainText("Tin mới đến", { timeout: 8000 });
  expect(asks[0]).toBe("");
  expect(asks.some(search => search === "?afterSeq=2")).toBe(true);
});

test("sending keeps Shift+Enter as a new line and does not send an empty message", async ({ page }) => {
  const chat: Chat = { role: "Buyer", state: "Created", canSend: true, messages: [], events: [] };
  const { posted } = await open(page, chat);
  const box = page.getByLabel("Nội dung tin nhắn");
  await expect(box).toBeVisible();
  await box.press("Enter");
  expect(posted).toEqual([]);
  await box.fill("Dòng 1");
  await box.press("Shift+Enter");
  await expect(box).toHaveValue("Dòng 1\n");
  await box.pressSequentially("Dòng 2");
  await box.press("Enter");
  await expect(page.getByRole("log", { name: "Tin nhắn" })).toContainText("Dòng 2");
  await expect(box).toHaveValue("");
  expect(posted).toEqual([{ text: "Dòng 1\nDòng 2" }]);
  await expect(page.getByText("Đính kèm", { exact: true })).toHaveCount(0);
});

test("a finished order is read only", async ({ page }) => {
  await open(page, { role: "Buyer", state: "Completed", canSend: false, messages: [message(1, true, "Đã xong")], events: [] });
  await expect(page.getByRole("log", { name: "Tin nhắn" })).toContainText("Đã xong");
  await expect(page.getByText("Cuộc trò chuyện chỉ còn để đọc")).toBeVisible();
  await expect(page.getByLabel("Nội dung tin nhắn")).toHaveCount(0);
});

test("the Arbiter is not given the chat before a dispute", async ({ page }) => {
  const { asks } = await open(page, { role: "Arbiter", state: "Funded", canSend: false, messages: [], events: [] }, { wallet: arbiter });
  await expect(page.getByText("Arbiter chỉ vào trò chuyện khi đơn có tranh chấp.")).toBeVisible();
  await expect(page.getByRole("log", { name: "Tin nhắn" })).toHaveCount(0);
  expect(asks).toEqual([]);
});

test("a failed poll shows a notice, keeps the messages and recovers", async ({ page }) => {
  let failing = false;
  const chat: Chat = { role: "Buyer", state: "Funded", canSend: true, messages: [message(1, true, "Vẫn còn đây")], events: [] };
  await open(page, chat, { fail: () => failing });
  const log = page.getByRole("log", { name: "Tin nhắn" });
  await expect(log).toContainText("Vẫn còn đây");
  failing = true;
  await expect(page.getByText("Chưa cập nhật được tin nhắn")).toBeVisible({ timeout: 8000 });
  await expect(log).toContainText("Vẫn còn đây");
  failing = false;
  chat.messages.push(message(2, false, "Đã kết nối lại"));
  await expect(log).toContainText("Đã kết nối lại", { timeout: 15000 });
  await expect(page.getByText("Chưa cập nhật được tin nhắn")).toHaveCount(0);
});
