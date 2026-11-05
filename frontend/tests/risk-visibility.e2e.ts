import { test, expect } from "@playwright/test";

const account = "0x1111111111111111111111111111111111111111";
const network = { status: "Ready", chainId: "31337", deploymentId: "risk", deploymentBlock: 1, deploymentBlockHash: "0x" + "ab".repeat(32), contractAddress: "0x4444444444444444444444444444444444444444" };
const draft = { id: "00000000-0000-0000-0000-000000000002", deploymentId: network.deploymentId, buyer: "0x5555555555555555555555555555555555555555", seller: "0x2222222222222222222222222222222222222222", arbiter: account, amountWei: "10000000000000000", description: "Thiết kế landing page", acceptanceCriteria: "Responsive", deliveryDeadline: 2000000000, reviewWindow: 3600, clientReference: "0x" + "11".repeat(32), termsJson: "{}", termsHash: "0x" + "22".repeat(32) };
const view = { draft, chain: { orderId: "1", state: "Disputed", sellerNetWei: "0", platformFeeWei: "0", buyerRefundWei: "0" }, termsMatch: true, syncStatus: "Ready", lastIndexedBlock: 7, files: [], deliveryFileMatchesChain: false };
const risk = { score: 95, level: "HIGH", reasons: ["Tài khoản Seller mới (0 ngày)"], reasonSource: "rule-based", scoringSource: "ml", modelVersion: "logistic-v1", featureVersion: "v1", evaluatedAt: "2026-11-05T00:00:00Z", dataSource: "synthetic" };

for (const admin of [true, false]) test(`mocked risk panel is ${admin ? "shown to the Admin" : "hidden from other accounts"}`, async ({ page }) => {
  const asked: string[] = [];
  await page.addInitScript(({ account, email }) => {
    sessionStorage.setItem("escrow.session", JSON.stringify({ accessToken: "risk", expiresAt: "2099-01-01T00:00:00Z", user: { id: "user", fullName: "Người dùng", email } }));
    (window as any).ethereum = { async request({ method }: { method: string }) {
      if (method === "eth_chainId") return "0x7a69";
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [account];
      throw new Error(`Unexpected wallet request ${method}`);
    } };
  }, { account, email: admin ? "viego.hvnh@gmail.com" : "arbiter@gmail.com" });
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    asked.push(path);
    return route.fulfill({ json: path.endsWith("/risk") ? risk : path.endsWith("/health/blockchain") ? network : path.endsWith("/wallets/me") ? { linked: true, address: account, chainId: 31337 }
      : path.endsWith("/orders") ? [view] : path.endsWith("/arbiters") || path.endsWith("/events") ? [] : view });
  });
  await page.route("**/rpc", route => {
    const input = route.request().postDataJSON();
    const answer = (r: any) => ({ jsonrpc: "2.0", id: r.id, result: r.method === "eth_chainId" ? "0x7a69" : "0x0" });
    return route.fulfill({ json: Array.isArray(input) ? input.map(answer) : answer(input) });
  });
  await page.goto("/");
  const navigation = page.getByRole("navigation", { name: "Chức năng" });
  if (admin) await navigation.getByRole("button", { name: "Phân xử", exact: true }).click();
  await page.getByRole("button", { name: `Mở đơn ${draft.description}`, exact: true }).click();
  const detail = page.getByRole("region", { name: "Chi tiết đơn", exact: true });
  await expect(detail).toBeVisible();
  if (admin) {
    await expect(detail.getByTestId("risk-result")).toContainText("95/100");
    await expect(detail.getByText("Điểm này không phải căn cứ phân xử.", { exact: false })).toBeVisible();
    await expect(navigation.getByRole("button", { name: "Thống kê", exact: true })).toBeVisible();
  } else {
    await expect(detail.getByText("Tiêu chí nghiệm thu", { exact: true })).toBeVisible();
    await expect(detail.getByLabel("Đánh giá rủi ro tham khảo")).toHaveCount(0);
    await expect(navigation.getByRole("button", { name: "Thống kê", exact: true })).toHaveCount(0);
    expect(asked.some(path => path.endsWith("/risk") || path.includes("/analytics/"))).toBe(false);
  }
});
