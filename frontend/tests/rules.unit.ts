import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { barWidth, categoryLabel, distributionRows, rateText, riskLevelText, scoringText } from "../src/domain/analytics";
import { parseEther, sha256, toUtf8Bytes } from "ethers";
import { formatVnd, VND_PER_ETH, vndToWei, WEI_PER_VND } from "../src/domain/money";
import { actions, amountWei, settlement, shareBps, validateTerms } from "../src/rules";
import type { NetworkStatus, OrderView } from "../src/types";

const buyer = "0x1111111111111111111111111111111111111111", seller = "0x2222222222222222222222222222222222222222", arbiter = "0x3333333333333333333333333333333333333333";
const network: NetworkStatus = { status: "Ready", deploymentId: "demo", chainId: "31337", contractAddress: "0x4444444444444444444444444444444444444444" };
function view(): OrderView { return {
  draft: { id: "id", deploymentId: "demo", buyer, seller, arbiter, amountWei: "1000", description: "Landing page", acceptanceCriteria: "375/1440px",
    deliveryDeadline: 100, reviewWindow: 10, clientReference: "0x" + "11".repeat(32), termsHash: "", termsJson: "", standardTermsVersion: "v1", createdAt: "" },
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
  expect(actions(order, seller, network, 100).product).toBe(true);
  expect(actions(order, seller, network, 101).product).toBe(false);
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

test("Disputes require on-chain delivery, not just an uploaded product", () => {
  const order = view();
  for (const state of [null, "Created", "Accepted", "Cancelled", "Funded", "Disputed", "Completed", "Resolved", "Refunded"] as const) {
    order.chain = state ? { ...view().chain!, state } : null;
    order.files = [{ id: "zip", kind: "product", fileName: "demo.zip", length: 1, sha256: "0x" + "11".repeat(32), createdAt: "" }];
    for (const wallet of [buyer, seller]) expect(actions(order, wallet, network, 99).dispute).toBe(false);
  }
  order.chain = { ...view().chain!, state: "Delivered", reviewDeadline: 110 };
  for (const wallet of [buyer, seller]) {
    expect(actions(order, wallet, network, 110).dispute).toBe(true);
    expect(actions(order, wallet, network, 111).dispute).toBe(false);
  }
  expect(actions(order, arbiter, network, 110).dispute).toBe(false);
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
  const terms = { version: 2, standardTermsVersion: "v1", standardTermsHash: "0x" + "cd".repeat(32), chainId: 31337, contract: network.contractAddress, deploymentId: d.deploymentId,
    clientReference: d.clientReference, buyer, seller, arbiter, description: d.description, acceptanceCriteria: d.acceptanceCriteria,
    amountWei: d.amountWei, deliveryDeadline: d.deliveryDeadline, reviewWindow: d.reviewWindow, feeBps: 100 };
  d.termsJson = JSON.stringify(terms); d.termsHash = sha256(toUtf8Bytes(d.termsJson));
  expect(() => validateTerms(order, network)).not.toThrow();
  d.amountWei = "1001"; expect(() => validateTerms(order, network)).toThrow();
  d.amountWei = "1000"; d.termsJson += " "; expect(() => validateTerms(order, network)).toThrow();
  d.termsJson = JSON.stringify(terms); d.termsHash = sha256(toUtf8Bytes(d.termsJson));
  d.standardTermsVersion = "other"; expect(() => validateTerms(order, network)).toThrow();
});
test("Seller must accept before funding; either party can cancel only before funding", () => {
  const order = view(); order.chain!.state = "Created";
  expect(actions(order, buyer, network, 50).deposit).toBe(false);
  expect(actions(order, buyer, network, 50).accept).toBe(false);
  expect(actions(order, arbiter, network, 50).accept).toBe(false);
  expect(actions(order, seller, network, 50).accept).toBe(true);
  expect(actions(order, seller, network, 101).accept).toBe(false);
  for (const wallet of [buyer, seller]) expect(actions(order, wallet, network, 50).cancel).toBe(true);
  expect(actions(order, arbiter, network, 50).cancel).toBe(false);
  order.chain!.state = "Accepted";
  expect(actions(order, buyer, network, 50).deposit).toBe(true);
  expect(actions(order, seller, network, 50).deposit).toBe(false);
  expect(actions(order, seller, network, 50).accept).toBe(false);
  for (const wallet of [buyer, seller]) expect(actions(order, wallet, network, 50).cancel).toBe(true);
  for (const state of ["Funded", "Delivered", "Cancelled", "Completed"] as const) {
    order.chain!.state = state;
    for (const wallet of [buyer, seller]) expect(actions(order, wallet, network, 50).cancel).toBe(false);
  }
  order.chain!.state = "Cancelled";
  expect(Object.values(actions(order, buyer, network, 50)).every(value => !value)).toBe(true);
});

test("Fixed VND rate is exact, never rounds and matches the backend constants", () => {
  assert.equal(vndToWei("1000000"), parseEther("0.01").toString());
  assert.equal(vndToWei("100.000.000"), parseEther("1").toString());
  assert.equal(vndToWei("1"), "10000000000");
  for (const bad of ["0", "-5", "1.5e3", "abc", "", "01"]) assert.throws(() => vndToWei(bad));
  assert.throws(() => vndToWei("1" + "0".repeat(28)));
  assert.equal(formatVnd(parseEther("0.01")), "1.000.000 ₫");
  assert.equal(formatVnd(parseEther("0.0099")), "990.000 ₫");
  assert.equal(formatVnd(0n), "0 ₫");
  assert.equal(formatVnd(1000n), "< 1 ₫");
  assert.equal(formatVnd(-parseEther("0.01")), "-1.000.000 ₫");
  assert.equal(VND_PER_ETH * WEI_PER_VND, parseEther("1"));
  const backend = readFileSync(resolve(process.cwd(), "../backend/StudentEscrow.Application/Wallets/ExchangeRate.cs"), "utf8");
  const constant = (name: string) => BigInt(new RegExp(`${name} = ([0-9_]+);`).exec(backend)![1].replace(/_/g, ""));
  assert.equal(constant("VndPerEth"), VND_PER_ETH);
  assert.equal(constant("WeiPerVnd"), WEI_PER_VND);
});
test("Analytics shows no data instead of a false 0%, and keeps small counts visible", () => {
  expect(rateText(0, 0)).toBe("Chưa có dữ liệu");
  expect(rateText(0, 5)).toBe("0%");
  expect(rateText(0.125, 8)).toBe("12,5%");
  expect(barWidth(0, 100)).toBe(0);
  expect(barWidth(1, 1000)).toBe(2);
  expect(barWidth(100, 100)).toBe(100);
  expect(distributionRows({ low: 1, medium: 0, high: 2, unavailable: 0, scoringSource: "ml", modelVersion: "x" }).map(row => row.key)).toEqual(["LOW", "MEDIUM", "HIGH"]);
  expect(distributionRows({ low: 0, medium: 0, high: 0, unavailable: 3, scoringSource: "unavailable", modelVersion: null }).at(-1)?.count).toBe(3);
  expect(categoryLabel("uncategorized")).toBe("Chưa phân loại");
});
test("Risk source is always named, so a fallback never passes as the model", () => {
  expect(scoringText({ scoringSource: "ml", modelVersion: "logistic-v1", dataSource: "synthetic" })).toContain("logistic-v1");
  expect(scoringText({ scoringSource: "ml", modelVersion: "logistic-v1", dataSource: "synthetic" })).toContain("giả lập");
  expect(scoringText({ scoringSource: "rule-based", modelVersion: null, dataSource: "rules" })).toContain("không phải mô hình");
  expect(riskLevelText.UNAVAILABLE).toBe("Chưa đánh giá được");
});
