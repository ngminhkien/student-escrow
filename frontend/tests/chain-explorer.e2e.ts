import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { Interface } from "ethers";
import abi from "../../blockchain/deployment/Escrow.abi.json" with { type: "json" };

const contract = "0x4444444444444444444444444444444444444444";
const wallet = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const network = { status: "Ready", deploymentId: "chain-test", chainId: "31337", contractAddress: contract, deploymentBlock: 1, deploymentBlockHash: "0x" + "ab".repeat(32), syncedBlock: 3, latestBlock: 3, message: "" };
const escrow = new Interface(abi);
const hashOf = (label: string) => "0x" + label.repeat(64).slice(0, 64);
const depositHash = hashOf("d"), transferHash = hashOf("e"), settleHash = hashOf("f");
const blockHash = (number: number) => "0x" + String(number).padStart(64, "0");
const tx = (hash: string, block: number, fields: Record<string, string>) => ({ hash, from: wallet, to: contract, value: "0x0", input: "0x", blockNumber: "0x" + block.toString(16), ...fields });
const deposited = escrow.encodeEventLog("Deposited", [7n, 1000000000000000n]);
const resolved = escrow.encodeEventLog("Resolved", [7n, 300000000000000n, 700000000000000n, 693000000000000n, 7000000000000n]);
const receipt = (logs: unknown[] = []) => ({ status: "0x1", gasUsed: "0x5208", effectiveGasPrice: "0x3b9aca00", contractAddress: null, logs });

type Options = { admin?: boolean; sqlState?: string; chainDown?: boolean; ledgerWei?: string; session?: boolean; extraTransfers?: number };
async function fixture(page: Page, options: Options = {}) {
  const transactions: Record<string, any> = {
    [transferHash]: tx(transferHash, 1, { to: other, value: "0x2386f26fc10000" }),
    [depositHash]: tx(depositHash, 2, { value: "0x38d7ea4c68000", input: escrow.encodeFunctionData("deposit", [7n]) }),
    [settleHash]: tx(settleHash, 3, { input: escrow.encodeFunctionData("resolveDispute", [7n, 7000n]) })
  };
  const receipts: Record<string, any> = {
    [transferHash]: receipt(),
    [depositHash]: receipt([{ address: contract, topics: deposited.topics, data: deposited.data }]),
    [settleHash]: receipt([{ address: contract, topics: resolved.topics, data: resolved.data }])
  };
  let head = 3;
  for (let index = 0; index < (options.extraTransfers ?? 0); index++) {
    head++;
    const hash = "0x" + head.toString(16).padStart(64, "a");
    transactions[hash] = tx(hash, head, { to: other, value: "0x1" });
    receipts[hash] = receipt();
  }
  const block = (number: number) => ({ number: "0x" + number.toString(16), hash: blockHash(number), parentHash: number ? blockHash(number - 1) : "0x" + "0".repeat(64), timestamp: "0x6553f100",
    transactions: Object.values(transactions).filter(item => item.blockNumber === "0x" + number.toString(16)) });
  await page.addInitScript(({ admin, wallet, session }) => {
    if (session) sessionStorage.setItem("escrow.session", JSON.stringify({ accessToken: "chain", expiresAt: "2099-01-01T00:00:00Z", user: { id: "chain", fullName: "Chain test", email: admin ? "viego.hvnh@gmail.com" : "student@example.test" } }));
    (window as any).ethereum = { isMetaMask: true, on() {}, removeListener() {}, request: async ({ method }: { method: string }) => method === "eth_accounts" ? [wallet] : method === "eth_chainId" ? "0x7a69" : null };
    const copied: string[] = [];
    (window as any).copied = copied;
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => { copied.push(text); } }, configurable: true });
  }, { admin: !!options.admin, wallet, session: options.session !== false });
  await page.route("**/rpc", async route => {
    if (options.chainDown) return route.abort();
    const body = route.request().postDataJSON();
    const answer = (item: { id: number; method: string; params: any[] }) => {
      const result = item.method === "eth_blockNumber" ? "0x" + head.toString(16)
        : item.method === "eth_chainId" ? "0x7a69"
        : item.method === "eth_getBlockByNumber" ? block(item.params[0] === "pending" ? head : Number(BigInt(item.params[0])))
        : item.method === "eth_getTransactionReceipt" ? receipts[item.params[0]] ?? null
        : item.method === "eth_getTransactionByHash" ? transactions[item.params[0]] ?? null
        : item.method === "eth_getBalance" ? "0xde0b6b3a7640000"
        : item.method === "eth_gasPrice" ? "0x3b9aca00"
        : item.method === "eth_call" ? call(item.params[0].data) : "0x0";
      return { jsonrpc: "2.0", id: item.id, result };
    };
    await route.fulfill({ json: Array.isArray(body) ? body.map(answer) : answer(body) });
  });
  function call(data: string) {
    const name = escrow.parseTransaction({ data })?.name;
    if (name === "totalLockedWei") return escrow.encodeFunctionResult(name, [1000000000000000n]);
    if (name === "getOrder") return escrow.encodeFunctionResult(name, [[wallet, other, contract, 1000000000000000n, 100n, "0x" + "1".repeat(64), "0x" + "2".repeat(64), 2000000000n, 300n, 0n, 0n, "0x" + "0".repeat(64), 1n, 0n]]);
    return "0x" + "0".repeat(63) + "1";
  }
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path.endsWith("/health/blockchain") ? network
      : path.endsWith("/wallets/me") ? { linked: true, address: wallet, chainId: 31337 }
      : path.endsWith("/admin/accounts") ? { accounts: [{ userId: "u", email: "buyer@example.test", fullName: "Buyer", address: other, custodial: true, balanceWei: options.ledgerWei ?? "500000000000000000", balanceVnd: "50000000", chainBalanceWei: "0", kycStatus: "VERIFIED", verifiedOnChain: true, approvedArbiter: false }], ledgerTotalWei: "0", ledgerTotalVnd: "0", treasuryWei: "0", contractWei: "0" }
      : path.endsWith("/admin/chain-orders") ? [{ orderId: "7", state: options.sqlState ?? "Funded", amountWei: "1000000000000000" }]
      : path.endsWith("/kyc/me") ? { status: "NOT_SUBMITTED", isMock: true }
      : [] });
  });
  return { addTransfer() { head++; const hash = "0x" + head.toString(16).padStart(64, "b"); transactions[hash] = tx(hash, head, { to: other, value: "0x1" }); receipts[hash] = receipt(); } };
}
const open = async (page: Page) => { await page.goto("/"); await page.getByRole("button", { name: "Blockchain", exact: true }).click(); };
const nav = (page: Page, name: string) => page.getByRole("group", { name: "Nội dung chain" }).getByRole("button", { name, exact: true });

test("transactions are listed as receipts in plain words, with no balance strip", async ({ page }) => {
  await fixture(page);
  await open(page);
  await expect(page.getByTestId("chain-head")).toHaveText("3");
  const list = page.getByRole("region", { name: "Biên lai giao dịch" });
  await expect(list.getByRole("row", { name: /Ký quỹ · Đơn #7/ })).toContainText("100.000 ₫");
  await expect(list.getByRole("row", { name: /Chuyển ETH/ })).toContainText("1.000.000 ₫");
  await expect(list.getByRole("row", { name: /Phân xử tranh chấp · Đơn #7/ })).toContainText("Thành công");
  await expect(page.getByRole("region", { name: "Số dư tài khoản" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Ví thanh toán" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Các block" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Đối chiếu SQL với chain" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Nội dung chain" }).getByRole("button")).toHaveCount(2);
});

test("a receipt shows what moved, gives a shareable link and copies each value", async ({ page }) => {
  await fixture(page);
  await open(page);
  await page.getByRole("region", { name: "Biên lai giao dịch" }).getByRole("link", { name: "Phân xử tranh chấp · Đơn #7" }).click();
  await expect(page).toHaveURL(new RegExp(`\\?tx=${settleHash}`));
  const bill = page.getByRole("article", { name: "Biên lai giao dịch" });
  await expect(bill.getByRole("heading")).toHaveText("Phân xử tranh chấp · Đơn #7");
  await expect(bill.getByTestId("receipt-amount")).toHaveText("100.000 ₫");
  await expect(bill).toContainText("Buyer được hoàn");
  await expect(bill).toContainText("Seller nhận");
  await expect(bill).toContainText("Phí nền tảng");
  await expect(bill).toContainText(settleHash);
  const proof = page.getByRole("complementary", { name: "Bằng chứng trên chain" });
  await expect(proof.getByTestId("receipt-block")).toHaveText("#3");
  await expect(proof.getByTestId("receipt-confirmations")).toHaveText("1");
  await expect(proof).toContainText(blockHash(2));
  await bill.getByRole("button", { name: "Sao chép mã giao dịch" }).click();
  await bill.getByRole("button", { name: "Sao chép ví gửi" }).click();
  await bill.getByRole("button", { name: "Sao chép link biên lai" }).click();
  await expect(bill.getByRole("button", { name: "Sao chép link biên lai" })).toContainText("Đã sao chép");
  const origin = new URL(page.url()).origin;
  expect(await page.evaluate(() => (window as any).copied)).toEqual([settleHash, wallet, `${origin}/?tx=${settleHash}`]);
  await page.getByRole("button", { name: "Danh sách biên lai" }).click();
  await expect(page).not.toHaveURL(/tx=/);
  await expect(bill).toHaveCount(0);
  await page.goBack();
  await expect(bill).toBeVisible();
});

test("the link opens the receipt with no account, read-only", async ({ page }) => {
  await fixture(page, { session: false });
  await page.goto(`/?tx=${depositHash}`);
  const bill = page.getByRole("article", { name: "Biên lai giao dịch" });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ký quỹ · Đơn #7");
  await expect(bill.getByTestId("receipt-amount")).toHaveText("100.000 ₫");
  await expect(page.getByLabel("Mật khẩu")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Xác nhận nghiệm thu" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Danh sách biên lai" })).toHaveCount(0);
  await page.getByRole("link", { name: "Đăng nhập" }).click();
  await expect(page.getByLabel("Mật khẩu", { exact: true })).toBeVisible();
});

test("a signed-in user opening the link lands on the Blockchain tab", async ({ page }) => {
  await fixture(page);
  await page.goto(`/?tx=${depositHash}`);
  await expect(page.getByRole("article", { name: "Biên lai giao dịch" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Blockchain", exact: true })).toHaveAttribute("aria-current", "page");
});

test("an unknown or malformed Txid is explained on its own page", async ({ page }) => {
  await fixture(page, { session: false });
  await page.goto(`/?tx=${hashOf("9")}`);
  await expect(page.getByRole("heading", { name: "Không tìm thấy biên lai" })).toBeVisible();
  await expect(page.getByText("biên lai của lần chạy trước không còn")).toBeVisible();
  await page.goto("/?tx=abc");
  await expect(page.getByText("Mã giao dịch phải gồm 0x và 64 ký tự.")).toBeVisible();
});

test("search opens a receipt or a wallet, and bad input is explained", async ({ page }) => {
  await fixture(page);
  await open(page);
  const input = page.getByLabel("Tra mã giao dịch hoặc địa chỉ ví");
  const search = page.getByRole("button", { name: "Tra cứu", exact: true });
  await input.fill(transferHash);
  await search.click();
  await expect(page.getByRole("article", { name: "Biên lai giao dịch" })).toContainText("Chuyển ETH");
  await input.fill(wallet);
  await search.click();
  const found = page.getByLabel("Thông tin ví");
  await expect(found).toContainText("1.0 ETH");
  await expect(found).toContainText("Đã xác minh trên contract");
  await expect(found.getByRole("button", { name: "Sao chép địa chỉ ví" })).toBeVisible();
  await input.fill("không phải mã");
  await search.click();
  await expect(page.getByRole("alert")).toContainText("Nhập mã giao dịch");
});

test("the search field and its button line up", async ({ page }) => {
  await fixture(page);
  await open(page);
  const field = await page.getByLabel("Tra mã giao dịch hoặc địa chỉ ví").boundingBox();
  const button = await page.getByRole("button", { name: "Tra cứu", exact: true }).boundingBox();
  expect(button!.y).toBe(field!.y);
  expect(button!.height).toBe(field!.height);
});

test("long lists are paged and a new transaction appears without reloading", async ({ page }) => {
  const chain = await fixture(page, { extraTransfers: 12 });
  await open(page);
  const list = page.getByRole("region", { name: "Biên lai giao dịch" });
  await expect(list.locator("tbody tr")).toHaveCount(10);
  await expect(page.getByTestId("chain-page")).toHaveText("Trang 1");
  await expect(page.getByRole("button", { name: "Trang trước" })).toBeDisabled();
  await page.getByRole("button", { name: "Trang sau" }).click();
  await expect(page.getByTestId("chain-page")).toHaveText("Trang 2");
  await expect(list.locator("tbody tr")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Trang sau" })).toBeDisabled();
  await page.getByRole("button", { name: "Trang trước" }).click();
  await expect(page.getByTestId("chain-head")).toHaveText("15");
  chain.addTransfer();
  await expect(page.getByTestId("chain-head")).toHaveText("16");
  await expect(list.locator("tbody tr").first()).toContainText("Block #16");
});

test("the blocks view is paged and links to its receipts", async ({ page }) => {
  await fixture(page, { extraTransfers: 12 });
  await open(page);
  await nav(page, "Các block").click();
  const blocks = page.getByRole("region", { name: "Các block" });
  await expect(blocks).toContainText("hash của block trước");
  await expect(blocks.locator("tbody tr")).toHaveCount(10);
  await expect(page.getByTestId("chain-page")).toHaveText("Trang 1 / 2");
  await page.getByRole("button", { name: "Trang sau" }).click();
  await expect(page.getByTestId("chain-page")).toHaveText("Trang 2 / 2");
  await expect(blocks.locator("tbody tr")).toHaveCount(6);
  await expect(blocks.getByRole("row", { name: /#0/ })).toContainText("Không có giao dịch");
  await blocks.getByRole("link", { name: `Xem biên lai ${depositHash}` }).click();
  await expect(page.getByRole("article", { name: "Biên lai giao dịch" })).toContainText("Ký quỹ · Đơn #7");
});

test("the Admin sees SQL agree with the chain", async ({ page }) => {
  await fixture(page, { admin: true });
  await open(page);
  await nav(page, "Đối chiếu").click();
  const panel = page.getByRole("region", { name: "Đối chiếu SQL với chain" });
  await expect(panel.getByTestId("reconciliation-summary")).toContainText("Tất cả đều khớp");
  await expect(panel.getByRole("row", { name: /#7/ })).toContainText("Khớp");
  await expect(panel.getByRole("row", { name: /buyer@example.test/ })).toContainText("Khớp");
});

test("a state SQL has wrong is reported, not hidden", async ({ page }) => {
  await fixture(page, { admin: true, sqlState: "Completed" });
  await open(page);
  await nav(page, "Đối chiếu").click();
  const panel = page.getByRole("region", { name: "Đối chiếu SQL với chain" });
  // The order differs, and so does the locked total since SQL no longer counts it.
  await expect(panel.getByTestId("reconciliation-summary")).toContainText("Có 2 khoản lệch");
  await expect(panel.getByRole("row", { name: /#7/ })).toContainText("Lệch");
});

test("a ledger balance with too little ETH behind it is reported", async ({ page }) => {
  // The node reports 1 ETH for this wallet.
  await fixture(page, { admin: true, ledgerWei: "2000000000000000000" });
  await open(page);
  await nav(page, "Đối chiếu").click();
  const panel = page.getByRole("region", { name: "Đối chiếu SQL với chain" });
  await expect(panel.getByTestId("reconciliation-summary")).toContainText("Có 1 khoản lệch");
  await expect(panel.getByRole("row", { name: /buyer@example.test/ })).toContainText("Lệch");
});

test("a node that is down is said plainly", async ({ page }) => {
  await fixture(page, { chainDown: true });
  await open(page);
  await expect(page.getByRole("alert").filter({ hasText: "Không đọc được node" })).toBeVisible();
});

for (const width of [375, 1440]) test(`the receipt and list fit at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await fixture(page, { admin: true, extraTransfers: 12 });
  await open(page);
  await expect(page.getByRole("region", { name: "Biên lai giao dịch" }).locator("tbody tr")).toHaveCount(10);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `../.artifacts/chain/list-${width}.png`, fullPage: true });
  await page.goto(`/?tx=${settleHash}`);
  await expect(page.getByRole("article", { name: "Biên lai giao dịch" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `../.artifacts/chain/receipt-${width}.png`, fullPage: true });
});
