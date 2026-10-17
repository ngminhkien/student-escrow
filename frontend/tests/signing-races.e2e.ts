import { test, expect } from "@playwright/test";
import { sha256, toUtf8Bytes } from "ethers";
const account = "0x1111111111111111111111111111111111111111";
const session = { accessToken: "race-token", expiresAt: "2099-01-01T00:00:00Z", user: { id: "race", fullName: "Race Test", email: "race@example.test" } };
for (const scenario of ["provider replaced during challenge", "logout during signature"] as const) {
  test(`mocked wallet linking rejects ${scenario}`, async ({ page }) => {
    let releaseChallenge!: () => void; let challengeStarted = false; let posts = 0;
    const heldChallenge = new Promise<void>(resolve => { releaseChallenge = resolve; });
    await page.addInitScript(({ session, account }) => {
      sessionStorage.setItem("escrow.session", JSON.stringify(session));
      const state = { signs: 0, release: () => {} };
      (window as any).__signRace = state;
      window.ethereum = { async request({ method }) {
        if (method === "eth_chainId") return "0x7a69";
        if (method === "eth_accounts" || method === "eth_requestAccounts") return [account];
        if (method === "personal_sign") { state.signs++; return new Promise(resolve => { state.release = () => resolve("0x" + "11".repeat(65)); }); }
        throw new Error(method);
      } };
    }, { session, account });
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/wallets/challenges")) {
        challengeStarted = true;
        if (scenario === "provider replaced during challenge") await heldChallenge;
        await route.fulfill({ json: { challengeId: "challenge", address: account, chainId: 31337, message: "Link test", expiresAt: "2099-01-01T00:00:00Z" } });
      } else if (path.endsWith("/wallets/link")) { posts++; await route.fulfill({ json: { linked: true, address: account, chainId: 31337 } }); }
      else await route.fulfill({ json: path.endsWith("/orders") ? [] : path.endsWith("/wallets/me") ? { linked: false, address: null, chainId: null } : { status: "Unavailable", isMock: true } });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Tài khoản & ví", exact: true }).click();
    await page.getByRole("button", { name: "Ký và liên kết ví", exact: true }).click();
    await expect.poll(() => challengeStarted).toBeTruthy();
    if (scenario === "provider replaced during challenge") {
      await page.evaluate(account => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { info: { rdns: "io.metamask" }, provider: { request: async ({ method }: { method: string }) => method === "eth_chainId" ? "0x7a69" : [account] } } })), account);
      releaseChallenge();
      await expect(page.getByRole("alert").filter({ hasText: /thay đổi/ })).toBeVisible();
      expect(await page.evaluate(() => (window as any).__signRace.signs)).toBe(0);
    } else {
      await expect.poll(() => page.evaluate(() => (window as any).__signRace.signs)).toBe(1);
      await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
      await page.evaluate(() => (window as any).__signRace.release());
      await expect(page.getByRole("status")).toHaveCount(0);
    }
    expect(posts).toBe(0);
  });
}

for (const stage of ["staticCall", "estimateGas"]) test(`mocked order logout during pending ${stage} suppresses transaction prompt`, async ({ page }) => {
  const network = { status: "Ready", deploymentId: "race-deploy", chainId: "31337", contractAddress: "0x4444444444444444444444444444444444444444", deploymentBlock: 1, deploymentBlockHash: "0x" + "ab".repeat(32) };
  const draft = { id: "00000000-0000-0000-0000-000000000001", deploymentId: network.deploymentId, buyer: account, seller: "0x2222222222222222222222222222222222222222", arbiter: "0x3333333333333333333333333333333333333333", amountWei: "1000", description: "Race order", acceptanceCriteria: "Test", deliveryDeadline: 2000000000, reviewWindow: 300, clientReference: "0x" + "11".repeat(32), termsJson: "", termsHash: "", createdAt: "2026-01-01T00:00:00Z" };
  draft.termsJson = JSON.stringify({ version: 1, chainId: 31337, contract: network.contractAddress, deploymentId: draft.deploymentId, buyer: draft.buyer, seller: draft.seller, arbiter: draft.arbiter, amountWei: draft.amountWei, description: draft.description, acceptanceCriteria: draft.acceptanceCriteria, deliveryDeadline: draft.deliveryDeadline, reviewWindow: draft.reviewWindow, clientReference: draft.clientReference, feeBps: 100 });
  draft.termsHash = sha256(toUtf8Bytes(draft.termsJson));
  const view = { draft, chain: { orderId: "1", state: "Created", deliveryHash: null, reviewDeadline: null, buyerRefundWei: "0", sellerNetWei: "0", platformFeeWei: "0" }, termsMatch: true, syncStatus: "Ready", files: [], deliveryFileMatchesChain: false, lastIndexedBlock: 1, checkedAt: "2099-01-01T00:00:00Z" };
  await page.addInitScript(({ session, account, hash, stage }) => {
    sessionStorage.setItem("escrow.session", JSON.stringify(session));
    const state = { entered: false, sends: 0, release: () => {} }; (window as any).__txRace = state;
    window.ethereum = { async request({ method }) {
      if (method === "eth_chainId") return "0x7a69";
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [account];
      if (method === "eth_getBlockByNumber") return { hash };
      if (method === "eth_getCode") return "0x01";
      if (method === "eth_blockNumber") return "0x1";
      if (method === "eth_call") {
        if (stage !== "staticCall") return "0x";
        state.entered = true; return new Promise(resolve => { state.release = () => resolve("0x"); });
      }
      if (method === "eth_estimateGas") { state.entered = true; return new Promise(resolve => { state.release = () => resolve("0x100000"); }); }
      if (method === "eth_sendTransaction") { state.sends++; throw new Error("Unexpected transaction prompt"); }
      throw new Error(method);
    } };
  }, { session, account, hash: network.deploymentBlockHash, stage });
  await page.route("**/rpc", async route => {
    const input = route.request().postDataJSON();
    const answer = (rpc: any) => ({ jsonrpc: "2.0", id: rpc.id, result: rpc.method === "eth_chainId" ? "0x7a69" : { timestamp: "0x6553f100" } });
    await route.fulfill({ json: Array.isArray(input) ? input.map(answer) : answer(input) });
  });
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path.endsWith("/health/blockchain") ? network : path.endsWith("/wallets/me") ? { linked: true, address: account, chainId: 31337 } : path.endsWith("/orders") ? [view] : path.endsWith("/events") ? [] : view });
  });
  await page.goto(`/?order=${draft.id}`);
  await page.getByRole("button", { name: /^Nạp .* ETH$/ }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__txRace.entered)).toBeTruthy();
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await page.evaluate(() => (window as any).__txRace.release());
  await expect(page.getByRole("status")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__txRace.sends)).toBe(0);
});
