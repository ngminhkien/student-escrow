import { test, expect } from "@playwright/test";

const account = "0x1111111111111111111111111111111111111111";
const network = { status: "Ready", chainId: "31337", deploymentId: "live", deploymentBlock: 1, deploymentBlockHash: "0x" + "ab".repeat(32), contractAddress: "0x4444444444444444444444444444444444444444" };
const draft = { id: "00000000-0000-0000-0000-000000000001", deploymentId: network.deploymentId, buyer: account, seller: "0x2222222222222222222222222222222222222222", arbiter: "0x3333333333333333333333333333333333333333", amountWei: "10000000000000000", description: "Thiết kế landing page", acceptanceCriteria: "Responsive", deliveryDeadline: 2000000000, reviewWindow: 3600, clientReference: "0x" + "11".repeat(32), termsJson: "{}", termsHash: "0x" + "22".repeat(32) };

test("another party's action shows up without waiting for the slow timer or reloading", async ({ page }) => {
  let block = 7, state = "Accepted", orderReads = 0;
  const view = () => ({ draft, chain: { orderId: "1", state, sellerNetWei: "0", platformFeeWei: "0", buyerRefundWei: "0", reviewDeadline: 0, deliveryHash: null }, termsMatch: true, syncStatus: "Ready", lastIndexedBlock: block, files: [], deliveryFileMatchesChain: false });
  await page.addInitScript(account => {
    sessionStorage.setItem("escrow.session", JSON.stringify({ accessToken: "live", expiresAt: "2099-01-01T00:00:00Z", user: { id: "buyer", fullName: "Buyer", email: "buyer@example.test" } }));
    (window as any).ethereum = { async request({ method }: { method: string }) { return method === "eth_chainId" ? "0x7a69" : [account]; } };
  }, account);
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/orders")) orderReads++;
    return route.fulfill({ json: path.endsWith("/health/blockchain") ? { ...network, lastIndexedBlock: block } : path.endsWith("/wallets/me") ? { linked: true, address: account, chainId: 31337 } : path.endsWith("/orders") ? [view()] : path.endsWith("/events") ? [] : view() });
  });
  await page.route("**/rpc", route => {
    const input = route.request().postDataJSON();
    const answer = (r: any) => ({ jsonrpc: "2.0", id: r.id, result: r.method === "eth_chainId" ? "0x7a69" : r.method === "eth_call" ? "0x" + "0".repeat(63) + "1" : r.method === "eth_getBalance" || r.method === "eth_gasPrice" ? "0x1" : { timestamp: "0x6553f100" } });
    return route.fulfill({ json: Array.isArray(input) ? input.map(answer) : answer(input) });
  });
  await page.goto(`/?order=${draft.id}`);
  const status = page.getByTestId("order-state");
  await expect(status).toHaveText("Seller đã chấp nhận");
  const loading = page.getByText("Đang tải chi tiết đơn…");

  // The worker has now indexed the Seller's delivery.
  state = "Delivered"; block = 8;
  const started = Date.now();
  await expect(status).toHaveText("Đã bàn giao", { timeout: 3000 });
  expect(Date.now() - started).toBeLessThan(3000);
  await expect(loading).toHaveCount(0);
  // The actions moved on with the state too: a delivered order can now be disputed.
  await expect(page.getByRole("button", { name: "Mở tranh chấp" })).toBeVisible();

  const before = orderReads;
  await page.waitForTimeout(2500);
  expect(orderReads - before, "with no new block the list stays on its slow timer").toBeLessThanOrEqual(1);
});
