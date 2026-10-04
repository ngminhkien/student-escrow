import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";
import { network } from "hardhat";
import { ZeroAddress, ZeroHash, id, parseEther, sha256, toUtf8Bytes } from "ethers";

const State = { Created: 0n, Funded: 1n, Delivered: 2n, Completed: 3n, Disputed: 4n, Resolved: 5n, Refunded: 6n };
const amount = parseEther("0.01");
const fileHash = sha256(toUtf8Bytes("demo file bytes"));

async function fixture(t: TestContext, receiverFee = false) {
  const connection = await network.create("hardhat");
  t.after(() => connection.close());
  const { ethers, provider } = connection;
  const [admin, buyer, seller, arbiter, platform, outsider, otherBuyer] = await ethers.getSigners();
  const receiver: any = await ethers.deployContract("SettlementReceiver");
  await receiver.waitForDeployment();
  const escrow: any = await ethers.deployContract("Escrow", [admin.address, receiverFee ? await receiver.getAddress() : platform.address]);
  await escrow.waitForDeployment();
  for (const wallet of [buyer.address, seller.address, otherBuyer.address, await receiver.getAddress()]) {
    await (await escrow.setWalletVerified(wallet, true)).wait();
  }
  const balance = async (address: string) => BigInt(await provider.request({ method: "eth_getBalance", params: [address, "latest"] }) as string);
  const now = async () => Number((await ethers.provider.getBlock("latest"))!.timestamp);
  const next = async (timestamp: number | bigint) => { await provider.request({ method: "evm_setNextBlockTimestamp", params: [Number(timestamp)] }); };
  const move = async (timestamp: number | bigint) => { await next(timestamp); await provider.request({ method: "evm_mine", params: [] }); };
  const args = async (changes: Record<string, unknown> = {}) => {
    const defaults = { seller: seller.address, arbiter: arbiter.address, amount, reference: id("draft-1"), terms: sha256(toUtf8Bytes("agreed terms v1")), deadline: await now() + 3600, review: 300 };
    const a = { ...defaults, ...changes };
    return [a.seller, a.arbiter, a.amount, a.reference, a.terms, a.deadline, a.review];
  };
  const create = async (changes: Record<string, unknown> = {}, signer = buyer) => {
    const orderId = await escrow.nextOrderId();
    await (await escrow.connect(signer).createOrder(...await args(changes))).wait();
    return orderId as bigint;
  };
  const funded = async (changes: Record<string, unknown> = {}) => {
    const orderId = await create(changes);
    const order = await escrow.getOrder(orderId);
    await (await escrow.connect(buyer).deposit(orderId, { value: order.amountWei })).wait();
    return orderId;
  };
  const delivered = async () => {
    const orderId = await funded();
    await (await escrow.connect(seller).markDelivered(orderId, fileHash)).wait();
    return orderId;
  };
  const events = (receipt: any, name: string) => receipt.logs.flatMap((log: any) => {
    try { const event = escrow.interface.parseLog(log); return event?.name === name ? [event.args] : []; } catch { return []; }
  });
  return { ethers, provider, escrow, receiver, admin, buyer, seller, arbiter, platform, outsider, otherBuyer, balance, now, next, move, args, create, funded, delivered, events };
}

async function reverts(call: Promise<unknown>, contract: any, name: string) {
  await assert.rejects(call, (error: any) => {
    const data = error.data ?? error.error?.data ?? error.info?.error?.data;
    const parsed = typeof data === "string" ? contract.interface.parseError(data) : undefined;
    assert.equal(parsed?.name, name, String(error));
    return true;
  });
}

describe("Escrow deployment and KYC", () => {
  it("separates KYC admin, order arbiter and fee recipient", async t => {
    const f = await fixture(t);
    assert.equal(await f.escrow.platformWallet(), f.platform.address);
    assert.equal(await f.escrow.hasRole(await f.escrow.KYC_ADMIN_ROLE(), f.admin.address), true);
    assert.equal(await f.escrow.hasRole(await f.escrow.KYC_ADMIN_ROLE(), f.arbiter.address), false);
    const receipt = await (await f.escrow.setWalletVerified(f.outsider.address, true)).wait();
    assert.deepEqual([...f.events(receipt, "WalletVerificationUpdated")[0]], [f.outsider.address, true]);
  });
  for (const which of ["admin", "fee"] as const) it(`rejects zero ${which}`, async t => {
    const f = await fixture(t);
    await reverts(f.ethers.deployContract("Escrow", [which === "admin" ? ZeroAddress : f.admin.address, which === "fee" ? ZeroAddress : f.platform.address]), f.escrow, "InvalidAddress");
  });
  it("only a KYC admin can attest or revoke a wallet", async t => {
    const f = await fixture(t);
    for (const caller of [f.buyer, f.seller, f.arbiter, f.platform, f.outsider]) {
      await reverts(f.escrow.connect(caller).setWalletVerified.staticCall(f.outsider.address, true), f.escrow, "AccessControlUnauthorizedAccount");
    }
    await (await f.escrow.setWalletVerified(f.buyer.address, false)).wait();
    assert.equal(await f.escrow.verifiedWallets(f.buyer.address), false);
  });
  it("supports explicit KYC role delegation and revocation", async t => {
    const f = await fixture(t);
    const role = await f.escrow.KYC_ADMIN_ROLE();
    await (await f.escrow.grantRole(role, f.outsider.address)).wait();
    await (await f.escrow.connect(f.outsider).setWalletVerified(f.otherBuyer.address, false)).wait();
    assert.equal(await f.escrow.verifiedWallets(f.otherBuyer.address), false);
    await (await f.escrow.revokeRole(role, f.outsider.address)).wait();
    await reverts(f.escrow.connect(f.outsider).setWalletVerified.staticCall(f.otherBuyer.address, true), f.escrow, "AccessControlUnauthorizedAccount");
  });
  it("rejects zero and escrow addresses as verified wallets", async t => {
    const f = await fixture(t);
    for (const address of [ZeroAddress, await f.escrow.getAddress()]) await reverts(f.escrow.setWalletVerified.staticCall(address, true), f.escrow, "InvalidAddress");
  });
});

describe("Order creation and immutable terms", () => {
  it("stores canonical enum, fixed fee, reference, terms and complete creation event", async t => {
    const f = await fixture(t);
    const a = await f.args();
    const receipt = await (await f.escrow.connect(f.buyer).createOrder(...a)).wait();
    const order = await f.escrow.getOrder(1);
    assert.equal(order.state, State.Created);
    assert.equal(order.feeBps, 100n);
    assert.equal(order.buyer, f.buyer.address);
    assert.equal(order.seller, a[0]);
    assert.equal(order.arbiter, a[1]);
    assert.equal(order.termsHash, a[4]);
    assert.equal(order.deliveryDeadline, BigInt(a[5] as number));
    assert.equal(order.reviewWindow, 300n);
    assert.equal(await f.escrow.totalLockedWei(), 0n);
    assert.deepEqual([...f.events(receipt, "OrderCreated")[0]], [1n, a[3], f.buyer.address, a[0], a[1], amount, 100n, a[4], BigInt(a[5] as number), 300n]);
  });
  const badCases = [
    ["zero seller", { seller: ZeroAddress }, "InvalidAddress"],
    ["zero arbiter", { arbiter: ZeroAddress }, "InvalidAddress"],
    ["zero amount", { amount: 0n }, "InvalidAmount"],
    ["amount beyond SQL bound", { amount: 10n ** 38n }, "InvalidAmount"],
    ["zero reference", { reference: ZeroHash }, "InvalidHash"],
    ["zero terms hash", { terms: ZeroHash }, "InvalidHash"],
    ["zero review window", { review: 0 }, "InvalidReviewWindow"],
    ["review window beyond maximum", { review: 365 * 86400 + 1 }, "InvalidReviewWindow"],
    ["past deadline", { deadline: 1 }, "InvalidDeadline"],
    ["deadline beyond uint64", { deadline: 2n ** 64n }, "InvalidDeadline"],
  ] as const;
  for (const [name, changes, error] of badCases) it(`rejects ${name}`, async t => {
    const f = await fixture(t);
    await reverts(f.escrow.connect(f.buyer).createOrder.staticCall(...await f.args(changes)), f.escrow, error);
    assert.equal(await f.escrow.nextOrderId(), 1n);
  });
  it("rejects parties colliding with buyer, seller or escrow", async t => {
    const f = await fixture(t);
    for (const changes of [{ seller: f.buyer.address }, { arbiter: f.buyer.address }, { arbiter: f.seller.address }]) {
      await reverts(f.escrow.connect(f.buyer).createOrder.staticCall(...await f.args(changes)), f.escrow, "InvalidParties");
    }
    for (const changes of [{ seller: await f.escrow.getAddress() }, { arbiter: await f.escrow.getAddress() }]) {
      await reverts(f.escrow.connect(f.buyer).createOrder.staticCall(...await f.args(changes)), f.escrow, "InvalidAddress");
    }
  });
  for (const party of ["buyer", "seller"] as const) it(`direct calls cannot bypass unverified ${party}`, async t => {
    const f = await fixture(t);
    await (await f.escrow.setWalletVerified(f[party].address, false)).wait();
    await reverts(f.escrow.connect(f.buyer).createOrder.staticCall(...await f.args()), f.escrow, "WalletNotVerified");
  });
  it("allows the maximum amount and review window", async t => {
    const f = await fixture(t);
    const orderId = await f.create({ amount: 10n ** 38n - 1n, review: 365 * 86400 });
    assert.equal((await f.escrow.getOrder(orderId)).amountWei, await f.escrow.MAX_AMOUNT_WEI());
  });
  it("rejects a deadline equal to current timestamp", async t => {
    const f = await fixture(t);
    await reverts(f.escrow.connect(f.buyer).createOrder.staticCall(...await f.args({ deadline: await f.now() })), f.escrow, "InvalidDeadline");
  });
  it("deduplicates reference per buyer and permits another buyer's reference", async t => {
    const f = await fixture(t);
    await f.create();
    await reverts(f.escrow.connect(f.buyer).createOrder.staticCall(...await f.args()), f.escrow, "DuplicateReference");
    await f.create({}, f.otherBuyer);
    assert.equal(await f.escrow.nextOrderId(), 3n);
  });
  it("rejects unknown order IDs instead of treating mapping defaults as Created", async t => {
    const f = await fixture(t);
    for (const orderId of [0n, 1n, 999n]) {
      await reverts(f.escrow.getOrder(orderId), f.escrow, "OrderNotFound");
      await reverts(f.escrow.connect(f.buyer).deposit.staticCall(orderId, { value: amount }), f.escrow, "OrderNotFound");
    }
  });
});

describe("Funding and delivery", () => {
  for (const value of [0n, amount - 1n, amount + 1n]) it(`rejects incorrect deposit ${value}`, async t => {
    const f = await fixture(t); const orderId = await f.create();
    await reverts(f.escrow.connect(f.buyer).deposit.staticCall(orderId, { value }), f.escrow, "IncorrectDeposit");
    assert.equal(await f.escrow.totalLockedWei(), 0n);
  });
  it("only Buyer can deposit, only once; emitted amount and locked balance match", async t => {
    const f = await fixture(t); const orderId = await f.create();
    await reverts(f.escrow.connect(f.seller).deposit.staticCall(orderId, { value: amount }), f.escrow, "Unauthorized");
    const receipt = await (await f.escrow.connect(f.buyer).deposit(orderId, { value: amount })).wait();
    assert.deepEqual([...f.events(receipt, "Deposited")[0]], [orderId, amount]);
    assert.equal((await f.escrow.getOrder(orderId)).state, State.Funded);
    assert.equal(await f.escrow.totalLockedWei(), amount);
    assert.equal(await f.balance(await f.escrow.getAddress()), amount);
    await reverts(f.escrow.connect(f.buyer).deposit.staticCall(orderId, { value: amount }), f.escrow, "InvalidState");
  });
  for (const party of ["buyer", "seller"] as const) it(`rechecks ${party} KYC before funding`, async t => {
    const f = await fixture(t); const orderId = await f.create();
    await (await f.escrow.setWalletVerified(f[party].address, false)).wait();
    await reverts(f.escrow.connect(f.buyer).deposit.staticCall(orderId, { value: amount }), f.escrow, "WalletNotVerified");
  });
  it("permits deposit exactly at delivery deadline", async t => {
    const f = await fixture(t); const orderId = await f.create();
    await f.next((await f.escrow.getOrder(orderId)).deliveryDeadline);
    await (await f.escrow.connect(f.buyer).deposit(orderId, { value: amount })).wait();
    assert.equal((await f.escrow.getOrder(orderId)).state, State.Funded);
  });
  it("expired unfunded orders remain Created and cannot be funded or refunded", async t => {
    const f = await fixture(t); const orderId = await f.create();
    await f.move((await f.escrow.getOrder(orderId)).deliveryDeadline + 1n);
    await reverts(f.escrow.connect(f.buyer).deposit.staticCall(orderId, { value: amount }), f.escrow, "DeadlinePassed");
    await reverts(f.escrow.connect(f.buyer).refundIfExpired.staticCall(orderId), f.escrow, "InvalidState");
    assert.equal((await f.escrow.getOrder(orderId)).state, State.Created);
  });
  it("only Seller delivers a funded order with a nonzero file hash, once", async t => {
    const f = await fixture(t); const orderId = await f.create();
    await reverts(f.escrow.connect(f.seller).markDelivered.staticCall(orderId, fileHash), f.escrow, "InvalidState");
    await (await f.escrow.connect(f.buyer).deposit(orderId, { value: amount })).wait();
    await reverts(f.escrow.connect(f.buyer).markDelivered.staticCall(orderId, fileHash), f.escrow, "Unauthorized");
    await reverts(f.escrow.connect(f.seller).markDelivered.staticCall(orderId, ZeroHash), f.escrow, "InvalidHash");
    const receipt = await (await f.escrow.connect(f.seller).markDelivered(orderId, fileHash)).wait();
    const order = await f.escrow.getOrder(orderId);
    assert.equal(order.deliveryHash, fileHash);
    assert.equal(order.reviewDeadline, order.deliveredAt + 300n);
    assert.equal(order.state, State.Delivered);
    assert.deepEqual([...f.events(receipt, "Delivered")[0]], [orderId, fileHash, order.deliveredAt, order.reviewDeadline]);
    await reverts(f.escrow.connect(f.seller).markDelivered.staticCall(orderId, fileHash), f.escrow, "InvalidState");
  });
  it("delivery at deadline succeeds and uses a separate review deadline", async t => {
    const f = await fixture(t); const orderId = await f.funded();
    const deadline = (await f.escrow.getOrder(orderId)).deliveryDeadline;
    await f.next(deadline);
    await (await f.escrow.connect(f.seller).markDelivered(orderId, fileHash)).wait();
    assert.equal((await f.escrow.getOrder(orderId)).reviewDeadline, deadline + 300n);
  });
  it("delivery one second late fails", async t => {
    const f = await fixture(t); const orderId = await f.funded();
    await f.move((await f.escrow.getOrder(orderId)).deliveryDeadline + 1n);
    await reverts(f.escrow.connect(f.seller).markDelivered.staticCall(orderId, fileHash), f.escrow, "DeadlinePassed");
  });
});

describe("Release, refunds and review timeout", () => {
  it("confirmation pays Seller minus 1% with exact event and no remaining lock", async t => {
    const f = await fixture(t); const orderId = await f.delivered();
    const sellerBefore = await f.balance(f.seller.address), feeBefore = await f.balance(f.platform.address);
    const receipt = await (await f.escrow.connect(f.buyer).confirmReceipt(orderId)).wait();
    const fee = amount / 100n;
    assert.equal(await f.balance(f.seller.address) - sellerBefore, amount - fee);
    assert.equal(await f.balance(f.platform.address) - feeBefore, fee);
    assert.deepEqual([...f.events(receipt, "Released")[0]], [orderId, amount, amount - fee, fee]);
    assert.equal((await f.escrow.getOrder(orderId)).state, State.Completed);
    assert.equal(await f.escrow.totalLockedWei(), 0n);
    assert.equal(await f.balance(await f.escrow.getAddress()), 0n);
  });
  it("only Buyer confirms, only after delivery", async t => {
    const f = await fixture(t); const orderId = await f.funded();
    await reverts(f.escrow.connect(f.buyer).confirmReceipt.staticCall(orderId), f.escrow, "InvalidState");
    await (await f.escrow.connect(f.seller).markDelivered(orderId, fileHash)).wait();
    await reverts(f.escrow.connect(f.seller).confirmReceipt.staticCall(orderId), f.escrow, "Unauthorized");
  });
  it("confirmation succeeds exactly at review deadline", async t => {
    const f = await fixture(t); const orderId = await f.delivered();
    await f.next((await f.escrow.getOrder(orderId)).reviewDeadline);
    await (await f.escrow.connect(f.buyer).confirmReceipt(orderId)).wait();
    assert.equal((await f.escrow.getOrder(orderId)).state, State.Completed);
  });
  it("late Buyer confirmation fails; only Seller can claim after review", async t => {
    const f = await fixture(t); const orderId = await f.delivered();
    const deadline = (await f.escrow.getOrder(orderId)).reviewDeadline;
    await f.move(deadline);
    await reverts(f.escrow.connect(f.seller).claimAfterReviewTimeout.staticCall(orderId), f.escrow, "DeadlineNotPassed");
    await f.move(deadline + 1n);
    await reverts(f.escrow.connect(f.buyer).confirmReceipt.staticCall(orderId), f.escrow, "DeadlinePassed");
    await reverts(f.escrow.connect(f.buyer).claimAfterReviewTimeout.staticCall(orderId), f.escrow, "Unauthorized");
    const before = await f.balance(f.seller.address);
    const receipt = await (await f.escrow.connect(f.seller).claimAfterReviewTimeout(orderId)).wait();
    assert.equal(await f.balance(f.seller.address) - before + receipt.fee, amount - amount / 100n);
    assert.equal((await f.escrow.getOrder(orderId)).state, State.Completed);
    assert.equal(f.events(receipt, "Released").length, 1);
  });
  it("only Buyer refunds strictly after delivery deadline; refund has zero fee", async t => {
    const f = await fixture(t); const orderId = await f.funded();
    const deadline = (await f.escrow.getOrder(orderId)).deliveryDeadline;
    await f.move(deadline);
    await reverts(f.escrow.connect(f.buyer).refundIfExpired.staticCall(orderId), f.escrow, "DeadlineNotPassed");
    await f.move(deadline + 1n);
    await reverts(f.escrow.connect(f.seller).refundIfExpired.staticCall(orderId), f.escrow, "Unauthorized");
    const buyerBefore = await f.balance(f.buyer.address), feeBefore = await f.balance(f.platform.address);
    const receipt = await (await f.escrow.connect(f.buyer).refundIfExpired(orderId)).wait();
    assert.equal(await f.balance(f.buyer.address) - buyerBefore + receipt.fee, amount);
    assert.equal(await f.balance(f.platform.address), feeBefore);
    assert.deepEqual([...f.events(receipt, "Refunded")[0]], [orderId, amount]);
    assert.equal((await f.escrow.getOrder(orderId)).state, State.Refunded);
    assert.equal(await f.escrow.totalLockedWei(), 0n);
  });
  it("Buyer cannot refund an already delivered order", async t => {
    const f = await fixture(t); const orderId = await f.delivered();
    await f.move((await f.escrow.getOrder(orderId)).deliveryDeadline + 1n);
    await reverts(f.escrow.connect(f.buyer).refundIfExpired.staticCall(orderId), f.escrow, "InvalidState");
  });
});

describe("Disputes and conservation of wei", () => {
  for (const stage of ["Funded", "Delivered"] as const) for (const party of ["buyer", "seller"] as const) {
    it(`${party} may dispute ${stage} exactly at its deadline`, async t => {
      const f = await fixture(t); const orderId = stage === "Funded" ? await f.funded() : await f.delivered();
      const order = await f.escrow.getOrder(orderId);
      await f.next(stage === "Funded" ? order.deliveryDeadline : order.reviewDeadline);
      const receipt = await (await f.escrow.connect(f[party]).raiseDispute(orderId)).wait();
      assert.deepEqual([...f.events(receipt, "Disputed")[0]], [orderId, f[party].address]);
      assert.equal((await f.escrow.getOrder(orderId)).state, State.Disputed);
      assert.equal(await f.escrow.totalLockedWei(), amount);
    });
  }
  for (const stage of ["Funded", "Delivered"] as const) it(`rejects late dispute from ${stage}`, async t => {
    const f = await fixture(t); const orderId = stage === "Funded" ? await f.funded() : await f.delivered();
    const order = await f.escrow.getOrder(orderId);
    await f.move((stage === "Funded" ? order.deliveryDeadline : order.reviewDeadline) + 1n);
    await reverts(f.escrow.connect(f.buyer).raiseDispute.staticCall(orderId), f.escrow, "DeadlinePassed");
  });
  it("outsiders cannot dispute; Created cannot be disputed or resolved", async t => {
    const f = await fixture(t); const orderId = await f.create();
    await reverts(f.escrow.connect(f.buyer).raiseDispute.staticCall(orderId), f.escrow, "InvalidState");
    await reverts(f.escrow.connect(f.arbiter).resolveDispute.staticCall(orderId, 7000), f.escrow, "InvalidState");
    await (await f.escrow.connect(f.buyer).deposit(orderId, { value: amount })).wait();
    await reverts(f.escrow.connect(f.outsider).raiseDispute.staticCall(orderId), f.escrow, "Unauthorized");
  });
  it("Disputed blocks every normal release/refund/delivery route even after deadlines", async t => {
    const f = await fixture(t); const orderId = await f.delivered();
    await (await f.escrow.connect(f.buyer).raiseDispute(orderId)).wait();
    await f.move((await f.escrow.getOrder(orderId)).deliveryDeadline + 1000n);
    for (const [signer, method, values] of [
      [f.buyer, "confirmReceipt", []], [f.buyer, "refundIfExpired", []],
      [f.seller, "claimAfterReviewTimeout", []], [f.seller, "markDelivered", [fileHash]],
      [f.buyer, "raiseDispute", []],
    ] as const) await reverts(f.escrow.connect(signer)[method].staticCall(orderId, ...values), f.escrow, "InvalidState");
    assert.equal(await f.escrow.totalLockedWei(), amount);
  });
  it("only the order's Arbiter resolves; KYC admin has no settlement authority", async t => {
    const f = await fixture(t); const orderId = await f.funded();
    await (await f.escrow.connect(f.seller).raiseDispute(orderId)).wait();
    for (const signer of [f.admin, f.buyer, f.seller, f.platform, f.outsider]) await reverts(f.escrow.connect(signer).resolveDispute.staticCall(orderId, 7000), f.escrow, "Unauthorized");
    await reverts(f.escrow.connect(f.arbiter).resolveDispute.staticCall(orderId, 10001), f.escrow, "InvalidShare");
  });
  for (const [value, share] of [[amount, 7000n], [amount, 0n], [amount, 10000n], [101n, 3333n], [1n, 7000n], [9999n, 9999n]] as const) {
    it(`settles ${value} wei at ${share} bps without loss or fee on Buyer refund`, async t => {
      const f = await fixture(t); const orderId = await f.funded({ amount: value });
      await (await f.escrow.connect(f.buyer).raiseDispute(orderId)).wait();
      const gross = value * share / 10000n, refund = value - gross, fee = gross / 100n, net = gross - fee;
      const before = await Promise.all([f.balance(f.buyer.address), f.balance(f.seller.address), f.balance(f.platform.address)]);
      const receipt = await (await f.escrow.connect(f.arbiter).resolveDispute(orderId, share)).wait();
      assert.deepEqual([...f.events(receipt, "Resolved")[0]], [orderId, refund, gross, net, fee]);
      assert.deepEqual(await Promise.all([f.balance(f.buyer.address), f.balance(f.seller.address), f.balance(f.platform.address)]), [before[0] + refund, before[1] + net, before[2] + fee]);
      assert.equal(refund + net + fee, value);
      assert.equal(await f.escrow.totalLockedWei(), 0n);
      assert.equal(await f.balance(await f.escrow.getAddress()), 0n);
      assert.equal((await f.escrow.getOrder(orderId)).state, State.Resolved);
    });
  }
  it("deterministic generated amounts and shares preserve allocation across many orders", async t => {
    const f = await fixture(t);
    let seed = 137n;
    for (let i = 0; i < 32; i++) {
      seed = (seed * 1664525n + 1013904223n) % (2n ** 32n);
      const value = seed * 1234567n + 1n;
      const share = seed % 10001n;
      const orderId = await f.funded({ amount: value, reference: id(`generated-${i}`) });
      await (await f.escrow.connect(f.seller).raiseDispute(orderId)).wait();
      const receipt = await (await f.escrow.connect(f.arbiter).resolveDispute(orderId, share)).wait();
      const e = f.events(receipt, "Resolved")[0];
      assert.equal(e.sellerGrossWei, value * share / 10000n);
      assert.equal(e.platformFeeWei, e.sellerGrossWei / 100n);
      assert.equal(e.buyerRefundWei + e.sellerNetWei + e.platformFeeWei, value);
      assert.equal(await f.escrow.totalLockedWei(), 0n);
      assert.equal(await f.balance(await f.escrow.getAddress()), 0n);
    }
  });
});

describe("Terminal states, KYC revocation and isolation", () => {
  for (const finalState of ["Completed", "Resolved", "Refunded"] as const) it(`${finalState} cannot be settled, funded or delivered again`, async t => {
    const f = await fixture(t); const orderId = await f.funded();
    if (finalState === "Completed") {
      await (await f.escrow.connect(f.seller).markDelivered(orderId, fileHash)).wait();
      await (await f.escrow.connect(f.buyer).confirmReceipt(orderId)).wait();
    } else if (finalState === "Resolved") {
      await (await f.escrow.connect(f.buyer).raiseDispute(orderId)).wait();
      await (await f.escrow.connect(f.arbiter).resolveDispute(orderId, 0)).wait();
    } else {
      await f.move((await f.escrow.getOrder(orderId)).deliveryDeadline + 1n);
      await (await f.escrow.connect(f.buyer).refundIfExpired(orderId)).wait();
    }
    for (const [signer, method, values] of [
      [f.buyer, "deposit", [{ value: amount }]], [f.seller, "markDelivered", [fileHash]],
      [f.buyer, "confirmReceipt", []], [f.buyer, "refundIfExpired", []],
      [f.seller, "claimAfterReviewTimeout", []], [f.buyer, "raiseDispute", []],
      [f.arbiter, "resolveDispute", [7000]],
    ] as const) await reverts(f.escrow.connect(signer)[method].staticCall(orderId, ...values), f.escrow, "InvalidState");
    assert.equal((await f.escrow.getOrder(orderId)).state, State[finalState]);
    assert.equal(await f.escrow.totalLockedWei(), 0n);
  });
  for (const route of ["confirm", "refund", "claim", "dispute"] as const) it(`revoked KYC after Funded permits ${route}`, async t => {
    const f = await fixture(t); const orderId = await f.funded();
    await (await f.escrow.setWalletVerified(f.buyer.address, false)).wait();
    await (await f.escrow.setWalletVerified(f.seller.address, false)).wait();
    if (route === "refund") {
      await f.move((await f.escrow.getOrder(orderId)).deliveryDeadline + 1n);
      await (await f.escrow.connect(f.buyer).refundIfExpired(orderId)).wait();
    } else {
      await (await f.escrow.connect(f.seller).markDelivered(orderId, fileHash)).wait();
      if (route === "confirm") await (await f.escrow.connect(f.buyer).confirmReceipt(orderId)).wait();
      else if (route === "claim") {
        await f.move((await f.escrow.getOrder(orderId)).reviewDeadline + 1n);
        await (await f.escrow.connect(f.seller).claimAfterReviewTimeout(orderId)).wait();
      } else {
        await (await f.escrow.connect(f.seller).raiseDispute(orderId)).wait();
        await (await f.escrow.connect(f.arbiter).resolveDispute(orderId, 7000)).wait();
      }
    }
    assert.equal(await f.escrow.totalLockedWei(), 0n);
  });
  it("settling one order cannot consume another order's funds", async t => {
    const f = await fixture(t);
    const first = await f.delivered(), second = await f.funded({ reference: id("draft-2"), amount: amount * 2n });
    assert.equal(await f.escrow.totalLockedWei(), amount * 3n);
    await (await f.escrow.connect(f.buyer).confirmReceipt(first)).wait();
    assert.equal(await f.escrow.totalLockedWei(), amount * 2n);
    assert.equal(await f.balance(await f.escrow.getAddress()), amount * 2n);
    assert.equal((await f.escrow.getOrder(second)).state, State.Funded);
    await (await f.escrow.connect(f.seller).raiseDispute(second)).wait();
    await (await f.escrow.connect(f.arbiter).resolveDispute(second, 7000)).wait();
    assert.equal(await f.balance(await f.escrow.getAddress()), 0n);
  });
  it("unsolicited ETH cannot create a funding event or an admin withdrawal right", async t => {
    const f = await fixture(t); const address = await f.escrow.getAddress();
    await assert.rejects(f.outsider.sendTransaction({ to: address, value: 1n }));
    // Simulate forced ETH: liabilities may be less than balance, never more.
    await f.provider.request({ method: "hardhat_setBalance", params: [address, "0x7b"] });
    const orderId = await f.delivered();
    await (await f.escrow.connect(f.buyer).confirmReceipt(orderId)).wait();
    assert.equal(await f.balance(address), 123n);
    assert.equal(await f.escrow.totalLockedWei(), 0n);
    assert.equal(f.escrow.interface.hasFunction("withdraw"), false);
  });
});

describe("Recipient rejection and reentrancy", () => {
  for (const recipient of ["buyer", "seller", "platform"] as const) it(`a refusing ${recipient} rolls back all payout, state, lock and events`, async t => {
    const f = await fixture(t, recipient === "platform");
    const receiverAddress = await f.receiver.getAddress();
    let orderId: bigint;
    if (recipient === "buyer") {
      orderId = await f.escrow.nextOrderId();
      await (await f.receiver.execute(await f.escrow.getAddress(), f.escrow.interface.encodeFunctionData("createOrder", await f.args()))).wait();
      await (await f.receiver.execute(await f.escrow.getAddress(), f.escrow.interface.encodeFunctionData("deposit", [orderId]), { value: amount })).wait();
    } else orderId = await f.funded(recipient === "seller" ? { seller: receiverAddress } : {});
    await (await f.escrow.connect(recipient === "buyer" ? f.seller : f.buyer).raiseDispute(orderId)).wait();
    await (await f.receiver.configure(true, ZeroAddress, "0x")).wait();
    const addresses = [f.buyer.address, f.seller.address, f.platform.address, receiverAddress, await f.escrow.getAddress()];
    const before = await Promise.all(addresses.map(f.balance));
    // Send an actual mined reverting tx, rather than merely rejecting gas estimation.
    await assert.rejects(async () => { await (await f.escrow.connect(f.arbiter).resolveDispute(orderId, 7000, { gasLimit: 1000000 })).wait(); });
    assert.deepEqual(await Promise.all(addresses.map(f.balance)), before);
    assert.equal((await f.escrow.getOrder(orderId)).state, State.Disputed);
    assert.equal(await f.escrow.totalLockedWei(), amount);
    assert.equal((await f.escrow.queryFilter(f.escrow.filters.Resolved(orderId))).length, 0);
    await (await f.receiver.configure(false, ZeroAddress, "0x")).wait();
    await (await f.escrow.connect(f.arbiter).resolveDispute(orderId, 7000)).wait();
    assert.equal(await f.escrow.totalLockedWei(), 0n);
  });
  it("recipient callback cannot reenter payable deposit even for a different Created order", async t => {
    const f = await fixture(t, true); const receiverAddress = await f.receiver.getAddress();
    const second = await f.escrow.nextOrderId();
    await (await f.receiver.execute(await f.escrow.getAddress(), f.escrow.interface.encodeFunctionData("createOrder", await f.args({ reference: id("receiver-draft"), amount: 1n })))).wait();
    const first = await f.delivered();
    // Value is zero but guard must reject before IncorrectDeposit: nested transaction is blocked.
    await (await f.receiver.configure(false, await f.escrow.getAddress(), f.escrow.interface.encodeFunctionData("deposit", [second]))).wait();
    await (await f.escrow.connect(f.buyer).confirmReceipt(first)).wait();
    assert.equal(await f.receiver.attempts(), 1n);
    assert.equal(await f.receiver.reentrySucceeded(), false);
    assert.equal(await f.receiver.reentryError(), f.escrow.interface.getError("ReentrancyGuardReentrantCall")!.selector);
    assert.equal((await f.escrow.getOrder(second)).state, State.Created);
    assert.equal(await f.balance(receiverAddress), amount / 100n);
    assert.equal(await f.escrow.totalLockedWei(), 0n);
  });
  it("Seller callback cannot claim the settled order twice", async t => {
    const f = await fixture(t); const address = await f.escrow.getAddress();
    const orderId = await f.funded({ seller: await f.receiver.getAddress() });
    await (await f.receiver.execute(address, f.escrow.interface.encodeFunctionData("markDelivered", [orderId, fileHash]))).wait();
    await f.move((await f.escrow.getOrder(orderId)).reviewDeadline + 1n);
    await (await f.receiver.configure(false, address, f.escrow.interface.encodeFunctionData("claimAfterReviewTimeout", [orderId]))).wait();
    await (await f.receiver.execute(address, f.escrow.interface.encodeFunctionData("claimAfterReviewTimeout", [orderId]))).wait();
    assert.equal(await f.receiver.attempts(), 1n);
    assert.equal(await f.receiver.reentrySucceeded(), false);
    assert.equal(await f.receiver.reentryError(), f.escrow.interface.getError("ReentrancyGuardReentrantCall")!.selector);
    assert.equal(await f.balance(await f.receiver.getAddress()), amount - amount / 100n);
    assert.equal((await f.escrow.getOrder(orderId)).state, State.Completed);
    assert.equal(await f.escrow.totalLockedWei(), 0n);
  });
});
