import { test, expect } from "@playwright/test";

const account = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const hash = "0x" + "ab".repeat(32);
const oldHash = "0x" + "cd".repeat(32);
for (const mode of ["cached", "different"] as const) test(`mocked MetaMask diagnostic explains ${mode} network without submitting a transaction`, async ({ page }) => {
  await page.addInitScript(({ account, hash, oldHash, mode }) => {
    sessionStorage.setItem("escrow.session", JSON.stringify({ accessToken: "network-diagnostic", expiresAt: "2099-01-01T00:00:00Z", user: { id: "network-diagnostic", fullName: "Admin", email: "viego.hvnh@gmail.com" } }));
    (window as any).__walletRequests = [];
    window.ethereum = { async request({ method }) {
      (window as any).__walletRequests.push(method);
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [account];
      if (method === "eth_chainId") return "0x7a69";
      if (method === "eth_getBlockByNumber") return { hash: oldHash, parentHash: oldHash, number: "0x1", timestamp: "0x6553f100", nonce: "0x0000000000000000", difficulty: "0x0", gasLimit: "0x1c9c380", gasUsed: "0x0", miner: account, extraData: "0x", transactions: [], baseFeePerGas: "0x3b9aca00" };
      if (method === "eth_getBlockByHash") return mode === "cached" ? { hash, number: "0x1" } : null;
      if (method === "eth_getCode") return "0x6001";
      if (method === "eth_call") return "0x";
      if (method === "eth_blockNumber") return "0x1";
      if (method === "eth_estimateGas") return "0xbb27";
      if (method === "eth_getBalance") return "0xde0b6b3a7640000";
      if (method === "eth_gasPrice" || method === "eth_maxPriorityFeePerGas") return "0x3b9aca00";
      if (method === "eth_sendTransaction") throw Object.assign(new Error("Mock user rejected confirmation"), { code: 4001 });
      throw new Error(`Unexpected wallet request ${method}`);
    } };
  }, { account, hash, oldHash, mode });
  await page.route("**/api/**", route => route.fulfill({ json: route.request().url().includes("/wallets/me") ? { linked: true, address: account, chainId: 31337 } : { status: "Ready", chainId: "31337", deploymentId: "diagnostic", deploymentBlock: 1, deploymentBlockHash: hash, contractAddress: "0x4444444444444444444444444444444444444444" } }));
  await page.route("**/rpc", route => {
    const input = route.request().postDataJSON();
    const answer = (r: any) => ({ jsonrpc: "2.0", id: r.id, result: r.method === "eth_chainId" ? "0x7a69" : r.method === "eth_getCode" ? "0x6001" : r.method === "eth_call" ? "0x" + "0".repeat(63) + "1" : r.method === "eth_getBalance" || r.method === "eth_gasPrice" ? "0x1" : { timestamp: "0x6553f100" } });
    return route.fulfill({ json: Array.isArray(input) ? input.map(answer) : answer(input) });
  });
  await page.goto("/");
  await page.getByText("Số dư & kết nối", { exact: true }).click();
  await page.getByRole("button", { name: "Kiểm tra blockchain MetaMask", exact: true }).click();
  const result = page.getByLabel("Kết quả kiểm tra blockchain", { exact: true });
  await expect(result).toContainText(mode === "cached" ? "Đã xác minh MetaMask cùng blockchain" : "Không tìm thấy block deployment");
  await expect(result).toContainText(hash);
  await expect(result).toContainText(oldHash);
  await expect(result).toContainText("http://127.0.0.1:8545");
  expect(await page.evaluate(() => (window as any).__walletRequests.some((method: string) => /sign|sendTransaction/.test(method)))).toBe(false);

  // Exercise the actual admin button as well as the read-only diagnostic.
  await page.getByRole("textbox", { name: "Địa chỉ ví cần quản lý" }).fill("0x90f79bf6eb2c4f870365e785982e1f101e93b906");
  await page.getByRole("button", { name: "Tra cứu", exact: true }).click();
  const verify = page.getByRole("button", { name: "Xác minh ví", exact: true });
  await expect(verify).toBeEnabled();
  await verify.click();
  await expect(page.locator(".feedback").getByRole("alert")).toContainText(mode === "cached" ? "Bạn đã từ chối yêu cầu trong MetaMask" : "Không tìm thấy block deployment");
  const calls = await page.evaluate(() => (window as any).__walletRequests as string[]);
  expect(calls.includes("eth_sendTransaction")).toBe(mode === "cached");
  expect(calls.includes("eth_estimateGas")).toBe(mode === "cached");
});
