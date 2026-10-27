import { test, expect } from "@playwright/test";
import { prepareWallet } from "../src/infrastructure/wallet/prepareWallet";
import { isAdminAccount } from "../src/domain/access";
import type { WalletProvider } from "../src/infrastructure/wallet/useWallet";

const expected = "0x1111111111111111111111111111111111111111";
function wallet(options: { account?: string; chain?: string; reject?: boolean; wrongSelection?: boolean; missingChain?: boolean } = {}) {
  let account = options.account ?? expected;
  let chain = options.chain ?? "0x7a69";
  let added = false;
  const calls: string[] = [];
  const provider: WalletProvider = { async request({ method }) {
    calls.push(method);
    if (method === "eth_accounts") return account ? [account] : [];
    if (method === "eth_requestAccounts") { account = expected; return [account]; }
    if (method === "eth_chainId") return chain;
    if (method === "wallet_requestPermissions") {
      if (options.reject) throw Object.assign(new Error("Rejected"), { code: 4001 });
      if (!options.wrongSelection) account = expected;
      return [];
    }
    if (method === "wallet_switchEthereumChain") {
      if (options.missingChain && !added) throw Object.assign(new Error("Unknown chain"), { code: 4902 });
      chain = "0x7a69"; return null;
    }
    if (method === "wallet_addEthereumChain") { added = true; return null; }
    throw new Error(`Unexpected method ${method}`);
  } };
  return { provider, calls };
}
test("matching wallet does not request permissions or signatures", async () => {
  const { provider, calls } = wallet();
  await prepareWallet(provider, expected, () => {});
  expect(calls).toEqual(["eth_accounts", "eth_chainId", "eth_accounts", "eth_chainId"]);
});
test("connects a disconnected wallet and adds the local network when missing", async () => {
  const { provider, calls } = wallet({ account: "", chain: "0x1", missingChain: true });
  await prepareWallet(provider, expected, () => {});
  expect(calls).toContain("eth_requestAccounts");
  expect(calls).toContain("wallet_addEthereumChain");
  expect(calls.filter(c => c === "wallet_switchEthereumChain")).toHaveLength(2);
});
test("wrong wallet opens MetaMask selection and then switches network", async () => {
  const { provider, calls } = wallet({ account: "0x2222222222222222222222222222222222222222", chain: "0x1" });
  await prepareWallet(provider, expected, () => {});
  expect(calls.indexOf("wallet_requestPermissions")).toBeLessThan(calls.indexOf("wallet_switchEthereumChain"));
});
test("rejecting account selection stops without switching or signing", async () => {
  const { provider, calls } = wallet({ account: "0x2222222222222222222222222222222222222222", chain: "0x1", reject: true });
  await expect(prepareWallet(provider, expected, () => {})).rejects.toMatchObject({ code: 4001 });
  expect(calls).not.toContain("wallet_switchEthereumChain");
  expect(calls).not.toContain("personal_sign");
});
test("wrong selection stays blocked with the required address", async () => {
  const { provider } = wallet({ account: "0x2222222222222222222222222222222222222222", wrongSelection: true });
  await expect(prepareWallet(provider, expected, () => {})).rejects.toThrow(expected);
});
test("session guard aborts after the pending wallet request before further prompts", async () => {
  let changed = false;
  const calls: string[] = [];
  const provider: WalletProvider = { async request({ method }) { calls.push(method); changed = true; return []; } };
  await expect(prepareWallet(provider, expected, () => { if (changed) throw new Error("Session changed"); })).rejects.toThrow("Session changed");
  expect(calls).toEqual(["eth_accounts"]);
});
test("only the configured admin email gets the admin workspace", () => {
  const session = (email: string) => ({ accessToken: "test", expiresAt: "2099-01-01", user: { id: "test", fullName: "Test", email } });
  expect(isAdminAccount(session(" VIEGO.HVNH@gmail.com "))).toBe(true);
  expect(isAdminAccount(session("buyertest@gmail.com"))).toBe(false);
  expect(isAdminAccount(null)).toBe(false);
});
