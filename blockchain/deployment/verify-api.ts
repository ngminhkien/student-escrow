import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Run after stopping and restarting only the API/worker, while the same Hardhat node stays alive.
const base = process.env.ESCROW_API_URL ?? "http://localhost:5180";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const saved = JSON.parse(await readFile(new URL("local/api-smoke-latest.json", import.meta.url), "utf8"));
async function get(path: string, token?: string): Promise<any> {
  const response = await fetch(base + path, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
const health = await get("/api/health/blockchain");
assert.equal(health.deploymentId, saved.deploymentId, "Keep the original node/deployment running for restart verification");
const response = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: saved.buyerEmail, password: "DemoPassword123!" }), signal: AbortSignal.timeout(15000) });
assert.equal(response.status, 200);
const { accessToken } = await response.json() as { accessToken: string };
const order = await get(`/api/orders/${saved.draftId}`, accessToken);
assert.equal(order.chain.state, "Refunded");
assert.equal(order.files.find((f: any) => f.kind === "product").sha256, saved.productHash);
assert.equal(order.files.length, 6);
assert.deepEqual((await get(`/api/orders/${saved.draftId}/events`, accessToken)).map((e: any) => e.name), ["OrderCreated", "Deposited", "Refunded"]);
assert.equal((await get(`/api/orders/${saved.disputeDraftId}`, accessToken)).chain.state, "Resolved");
assert.equal((await get(`/api/orders/${saved.disputeDraftId}/events`, accessToken)).length, 4);
console.log("PASS persisted files, checkpoint, order projections and deduplicated history after API restart");
