import { expect, test } from "@playwright/test";
import { sha256, toUtf8Bytes } from "ethers";
import { actions, amountWei, settlement, shareBps, validateTerms } from "../src/rules";
import type { NetworkStatus, OrderView } from "../src/types";

const buyer = "0x1111111111111111111111111111111111111111", seller = "0x2222222222222222222222222222222222222222", arbiter = "0x3333333333333333333333333333333333333333";
const network: NetworkStatus = { status: "Ready", deploymentId: "demo", chainId: "31337", contractAddress: "0x4444444444444444444444444444444444444444" };
function view(): OrderView { return {
  draft: { id: "id", deploymentId: "demo", buyer, seller, arbiter, amountWei: "1000", description: "Landing page", acceptanceCriteria: "375/1440px",
    deliveryDeadline: 100, reviewWindow: 10, clientReference: "0x" + "11".repeat(32), termsHash: "", termsJson: "", createdAt: "" },
  chain: { orderId: "1", state: "Funded", deliveryHash: null, reviewDeadline: null, buyerRefundWei: "0", sellerNetWei: "0", platformFeeWei: "0" },
  termsMatch: true, syncStatus: "Ready", lastIndexedBlock: 1, checkedAt: "", files: [], deliveryFileMatchesChain: false
}; }
test("Amounts use exact wei, never floating point", () => {
  expect(amountWei("0.000000000000000001")).toBe("1"); expect(amountWei("0.01")).toBe("10000000000000000");
  for (const input of ["0", "-1", "1e3", "01", "1.0000000000000000001", "999999999999999999999999999999999999999"]) expect(() => amountWei(input)).toThrow();
});
test("Arbiter share and preview follow contract rounding", () => {
  expect(shareBps("70.25")).toBe(7025n); expect(shareBps("100")).toBe(10000n); expect(shareBps("0")).toBe(0n);
  for (const input of ["100.01", "-1", "1e2", "70.001"]) expect(() => shareBps(input)).toThrow();
  expect(settlement("1000", "70")).toEqual({ buyer: 300n, seller: 693n, fee: 7n });
  expect(settlement("1", "70")).toEqual({ buyer: 1n, seller: 0n, fee: 0n });
});
test("Delivery deadline is inclusive; refund starts strictly after", () => {
  const order = view();
  expect(actions(order, seller, network, 100).deliver).toBe(true);
  expect(actions(order, seller, network, 101).deliver).toBe(false);
  expect(actions(order, buyer, network, 100).refund).toBe(false);
  expect(actions(order, buyer, network, 101).refund).toBe(true);
  expect(actions(order, seller, network, 101).refund).toBe(false);
});
test("Review deadline, roles and ZIP hash control confirmation and timeout", () => {
  const order = view(); order.chain!.state = "Delivered"; order.chain!.reviewDeadline = 110;
  expect(actions(order, buyer, network, 110).confirm).toBe(false);
  order.deliveryFileMatchesChain = true;
  expect(actions(order, buyer, network, 110).confirm).toBe(true);
  expect(actions(order, buyer, network, 110).dispute).toBe(true);
  expect(actions(order, seller, network, 110).claim).toBe(false);
  expect(actions(order, seller, network, 111).claim).toBe(true);
  expect(actions(order, buyer, network, 111).confirm).toBe(false);
  expect(actions(order, buyer, network, 111).dispute).toBe(false);
});
test("Only assigned arbiter can resolve disputed orders", () => {
  const order = view(); order.chain!.state = "Disputed";
  expect(actions(order, arbiter, network, 200).resolve).toBe(true);
  expect(actions(order, buyer, network, 200).resolve).toBe(false);
  expect(actions(order, seller, network, 200).evidence).toBe(true);
  expect(actions(order, arbiter, network, 200).evidence).toBe(false);
});
test("Old deployment, stale synchronization and mismatched terms block writes", () => {
  const order = view();
  for (const badNetwork of [{ ...network, status: "Unavailable" }, { ...network, deploymentId: "another" }])
    expect(Object.values(actions(order, seller, badNetwork, 99)).every(v => !v)).toBe(true);
  order.termsMatch = false; expect(actions(order, seller, network, 99).deliver).toBe(false);
  order.termsMatch = true; order.syncStatus = "Stale"; expect(actions(order, seller, network, 99).deliver).toBe(false);
});
test("Completed states and file quotas remove obsolete actions", () => {
  const order = view(); order.chain!.state = "Completed";
  expect(Object.values(actions(order, buyer, network, 99)).every(v => !v)).toBe(true);
  order.chain!.state = "Funded";
  order.files = Array.from({ length: 5 }, (_, i) => ({ id: String(i), kind: "evidence", fileName: "x.png", length: 1, sha256: "", createdAt: "" }));
  expect(actions(order, seller, network, 99).evidence).toBe(false);
  order.files.push({ id: "zip", kind: "product", fileName: "demo.zip", length: 1, sha256: "", createdAt: "" });
  expect(actions(order, seller, network, 99).product).toBe(false);
});
test("Terms digest binds canonical JSON to displayed terms and current contract", () => {
  const order = view(), d = order.draft;
  const terms = { version: 1, chainId: 31337, contract: network.contractAddress, deploymentId: d.deploymentId,
    clientReference: d.clientReference, buyer, seller, arbiter, description: d.description, acceptanceCriteria: d.acceptanceCriteria,
    amountWei: d.amountWei, deliveryDeadline: d.deliveryDeadline, reviewWindow: d.reviewWindow, feeBps: 100 };
  d.termsJson = JSON.stringify(terms); d.termsHash = sha256(toUtf8Bytes(d.termsJson));
  expect(() => validateTerms(order, network)).not.toThrow();
  d.amountWei = "1001"; expect(() => validateTerms(order, network)).toThrow();
  d.amountWei = "1000"; d.termsJson += " "; expect(() => validateTerms(order, network)).toThrow();
});
