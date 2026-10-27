import { test, expect } from "@playwright/test";

for (const enough of [false, true]) test(`mocked transaction ${enough ? "opens confirmation with estimated gas" : "blocks confirmation when ETH does not cover gas"}`, async ({ page }) => {
  const network = { status: "Ready", deploymentId: "gas-test", chainId: "31337", contractAddress: "0x4444444444444444444444444444444444444444", deploymentBlock: 1, deploymentBlockHash: "0x" + "ab".repeat(32) };
  await page.addInitScript(({ hash, enough }) => {
    const account = "0x1111111111111111111111111111111111111111";
    const calls: string[] = [];
    (window as any).__gasCalls = calls;
    window.ethereum = { async request({ method }) {
      calls.push(method);
      if (method === "eth_chainId") return "0x7a69";
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [account];
      if (method === "eth_getCode") return "0x01";
      if (method === "eth_blockNumber") return "0x1";
      if (method === "eth_call") return "0x";
      if (method === "eth_estimateGas") return "0x5208";
      if (method === "eth_sendTransaction") throw new Error("Signature requested");
      if (method === "eth_getBalance") return enough ? "0xde0b6b3a7640000" : "0x3e8";
      if (method === "eth_gasPrice" || method === "eth_maxPriorityFeePerGas") return "0x3b9aca00";
      if (method === "eth_getBlockByNumber") return { hash, parentHash: hash, number: "0x1", timestamp: "0x6553f100", nonce: "0x0000000000000000", difficulty: "0x0", gasLimit: "0x1c9c380", gasUsed: "0x0", miner: account, extraData: "0x", transactions: [], baseFeePerGas: "0x3b9aca00" };
      throw new Error(`Unexpected wallet method ${method}`);
    } };
  }, { hash: network.deploymentBlockHash, enough });
  await page.route("**/api/**", route => route.fulfill({ json: network }));
  await page.route("**/rpc", route => {
    const input = route.request().postDataJSON();
    const answer = (r: any) => ({ jsonrpc: "2.0", id: r.id, result: r.method === "eth_chainId" ? "0x7a69" : { timestamp: "0x6553f100" } });
    return route.fulfill({ json: Array.isArray(input) ? input.map(answer) : answer(input) });
  });
  await page.goto("/");
  const error = await page.evaluate(async () => {
    const modulePath = "/src/infrastructure/wallet/transactions.ts";
    const { sendTransaction } = await import(/* @vite-ignore */ modulePath);
    try { await sendTransaction("0x1111111111111111111111111111111111111111", "gas-test", "deposit", ["1", { value: 1000n }], () => {}); }
    catch (failure) { return String(failure); }
    return "Unexpected success";
  });
  expect(error).toContain(enough ? "Signature requested" : "Ví không đủ ETH");
  if (!enough) expect(error).toContain("gas dự trù");
  const calls = await page.evaluate(() => (window as any).__gasCalls as string[]);
  expect(calls).toContain("eth_estimateGas");
  expect(calls).toContain("eth_getBalance");
  if (enough) expect(calls).toContain("eth_sendTransaction");
  else expect(calls).not.toContain("eth_sendTransaction");
});
