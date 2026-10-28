import { test, expect } from "@playwright/test";
import { inspectWalletNetwork, requireMatchingWalletNetwork } from "../src/infrastructure/wallet/networkIdentity";
import type { WalletProvider } from "../src/infrastructure/wallet/useWallet";

const hash = "0x" + "ab".repeat(32);
const oldHash = "0x" + "cd".repeat(32);
const network = { status: "Ready", chainId: "31337", contractAddress: "0x4444444444444444444444444444444444444444", deploymentBlock: 1, deploymentBlockHash: hash };
function provider(mode: "normal" | "cached" | "missing" | "noncanonical" | "wrong-code" | "wrong-chain" | "wrong-number") {
  const calls: { method: string; params: unknown[] | undefined }[] = [];
  const wallet: WalletProvider = { async request({ method, params }) {
    calls.push({ method, params: params as unknown[] | undefined });
    if (method === "eth_chainId") return mode === "wrong-chain" ? "0x1" : "0x7a69";
    if (method === "eth_getBlockByNumber") return { hash: mode === "normal" ? hash.toUpperCase() : oldHash, number: "0x1" };
    if (method === "eth_getBlockByHash") return mode === "missing" ? null : { hash, number: mode === "wrong-number" ? "0x2" : "0x1" };
    if (method === "eth_getCode") {
      if (mode === "noncanonical") throw Object.assign(new Error("Block is not canonical"), { code: -32000 });
      return mode === "wrong-code" ? "0x6002" : "0x6001";
    }
    throw new Error(`Unexpected request ${method}`);
  } };
  return { wallet, calls };
}
test("same deployment block passes without querying hash fallback", async () => {
  const { wallet, calls } = provider("normal");
  const result = await inspectWalletNetwork(wallet, network, () => {}, async () => { throw new Error("Unexpected API code lookup"); });
  expect(result.status).toBe("matched");
  expect(() => requireMatchingWalletNetwork(result)).not.toThrow();
  expect(calls.map(c => c.method)).toEqual(["eth_chainId", "eth_getBlockByNumber"]);
});
test("cached block-number data is accepted only with canonical deployment and matching contract code", async () => {
  const { wallet, calls } = provider("cached");
  const result = await inspectWalletNetwork(wallet, network, () => {}, async expected => { expect(expected).toBe(hash); return "0x6001"; });
  expect(result.status).toBe("cached-block");
  expect(result.walletHash).toBe(oldHash);
  expect(() => requireMatchingWalletNetwork(result)).not.toThrow();
  expect(calls.find(c => c.method === "eth_getCode")?.params).toEqual([network.contractAddress, { blockHash: hash, requireCanonical: true }]);
});
for (const mode of ["missing", "noncanonical", "wrong-code", "wrong-chain", "wrong-number"] as const) {
  test(`${mode} blockchain remains blocked`, async () => {
    const { wallet, calls } = provider(mode);
    const result = await inspectWalletNetwork(wallet, network, () => {}, async () => "0x6001");
    expect(["mismatch", "unavailable"]).toContain(result.status);
    expect(() => requireMatchingWalletNetwork(result)).toThrow();
    expect(calls.some(c => /sign|sendTransaction/.test(c.method))).toBe(false);
  });
}
test("wallet or session change aborts the diagnostic before further requests", async () => {
  let changed = false;
  const calls: string[] = [];
  const wallet: WalletProvider = { async request({ method }) { calls.push(method); changed = true; return "0x7a69"; } };
  await expect(inspectWalletNetwork(wallet, network, () => { if (changed) throw new Error("Session changed"); }, async () => "0x6001")).rejects.toThrow("Session changed");
  expect(calls).toEqual(["eth_chainId"]);
});
