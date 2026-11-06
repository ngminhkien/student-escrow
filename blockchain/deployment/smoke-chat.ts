import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { network } from "hardhat";

// Order chat against a running API, SQL and local node. Point the API at a throwaway database, with Hardhat account #0
// already imported into custody (see smoke-custodial.ts, SMOKE_SEED_LEGACY).
// Set SMOKE_CHAT_PERF_DB to that database's name to also add 5,000 messages to one order and measure latency.
const base = process.env.ESCROW_API_URL ?? "http://localhost:5180";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Smoke only supports a local API");
const password = "DemoPassword123!";
const adminEmail = process.env.ESCROW_ADMIN_EMAIL ?? "custody.admin@example.test";
const VND = 10_000_000_000n;
const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\nstartxref\n0\n%%EOF");

async function raw(path: string, token?: string, method = "GET", body?: unknown) {
  const multipart = body instanceof FormData;
  return fetch(`${base}/api${path}`, { method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(!multipart && body ? { "Content-Type": "application/json" } : {}) },
    body: body ? multipart ? body : JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) });
}
async function request(path: string, token?: string, method = "GET", body?: unknown, expected = 200): Promise<any> {
  const response = await raw(path, token, method, body);
  const text = await response.text();
  assert.equal(response.status, expected, `${method} ${path}: ${text}`);
  return text && (response.headers.get("content-type") ?? "").includes("json") ? JSON.parse(text) : text;
}
const code = (body: any) => body?.code ?? body?.error?.code;
const percentile = (values: number[], share: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * share))];
function report(label: string, values: number[]) {
  console.log(`  ${label}: n=${values.length} p50=${percentile(values, 0.5).toFixed(1)}ms p95=${percentile(values, 0.95).toFixed(1)}ms max=${Math.max(...values).toFixed(1)}ms`);
}

const connection = await network.create();
try {
  const { ethers } = connection;
  const admin = (await request("/auth/login", undefined, "POST", { email: adminEmail, password })).accessToken as string;
  const run = randomUUID();
  async function register(role: string) {
    const email = `chat.${run}.${role}@example.test`;
    const auth = await request("/auth/register", undefined, "POST", { email, fullName: `Chat ${role}`, password }, 201);
    return { token: auth.accessToken as string, address: (await request("/wallets/me", auth.accessToken)).address as string, email };
  }
  const [buyer, seller, arbiter, outsider] = [await register("buyer"), await register("seller"), await register("arbiter"), await register("outsider")];
  for (const actor of [buyer, seller]) await request("/admin/wallets/verification", admin, "POST", { address: actor.address, verified: true });
  await request("/admin/wallets/credits", admin, "POST", { address: buyer.address, amountVnd: 90_000_000, reference: randomUUID(), note: "Chat smoke" });
  await request("/admin/arbiters", admin, "POST", { address: arbiter.address, approved: true });
  for (let i = 0; ; i++) {
    if ((await request("/orders/arbiters", buyer.token)).some((row: any) => row.address.toLowerCase() === arbiter.address.toLowerCase())) break;
    assert.ok(i < 40, "Arbiter never reached the list");
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const terms = await request("/orders/terms", buyer.token);
  const act = (id: string, token: string, action: string, sellerShareBps?: number) =>
    request(`/orders/${id}/actions`, token, "POST", { action, sellerShareBps, acceptedTermsVersion: action === "accept" ? terms.version : undefined });
  async function reach(id: string, state: string) {
    for (let i = 0; i < 40; i++) {
      const view = await request(`/orders/${id}`, buyer.token);
      if (view.chain?.state === state && view.syncStatus === "Ready") return view;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`Timed out waiting for ${state}`);
  }
  async function draft(description: string) {
    const deadline = Math.max((await ethers.provider.getBlock("latest"))!.timestamp, Math.floor(Date.now() / 1000)) + 3600;
    const view = await request("/orders", buyer.token, "POST", { sellerEmail: seller.email, arbiter: arbiter.address, acceptedTermsVersion: terms.version,
      description, acceptanceCriteria: "Chạy được", amountWei: (1_000_000n * VND).toString(), deliveryDeadline: deadline, reviewWindow: 300 }, 201);
    return view.draft.id as string;
  }
  const say = (id: string, token: string, text: string) => request(`/orders/${id}/chat`, token, "POST", { text });
  const read = (id: string, token: string, query = "") => request(`/orders/${id}/chat${query}`, token);
  async function fund(id: string) {
    await act(id, buyer.token, "create"); await reach(id, "Created");
    await act(id, seller.token, "accept"); await reach(id, "Accepted");
    await act(id, buyer.token, "deposit"); return reach(id, "Funded");
  }

  const id = await draft("Làm trang web theo yêu cầu");
  assert.equal((await say(id, buyer.token, "Bạn làm kịp trong tuần không?")).seq, 1);
  assert.equal((await say(id, seller.token, "Kịp, mình bắt đầu ngay.")).seq, 2);
  let page = await read(id, buyer.token);
  assert.deepEqual(page.messages.map((item: any) => item.mine), [true, false]);
  assert.equal(page.state, "Draft");
  assert.equal((await request("/orders/chat/unread", seller.token)).find((row: any) => row.draftId === id).count, 1);
  await request(`/orders/${id}/chat/read`, seller.token, "POST", { seq: 2 }, 204);
  assert.equal((await request("/orders/chat/unread", seller.token)).find((row: any) => row.draftId === id), undefined);
  console.log("PASS parties talk before the order is on chain, and unread counts clear");

  await request(`/orders/${id}/chat`, outsider.token, "GET", undefined, 404);
  await request(`/orders/${id}/chat`, outsider.token, "POST", { text: "Xin vào" }, 404);
  assert.equal(code(await request(`/orders/${id}/chat`, arbiter.token, "GET", undefined, 403)), "CHAT_NOT_OPEN");
  await request(`/orders/${id}/chat`, arbiter.token, "POST", { text: "Xin vào" }, 403);
  await request(`/orders/${id}/chat`, undefined, "GET", undefined, 401);
  console.log("PASS outsiders, the Arbiter before a dispute and anonymous callers are refused");

  await fund(id);
  page = await read(id, buyer.token);
  assert.deepEqual(page.events.map((item: any) => item.name), ["OrderCreated", "OrderAccepted", "Deposited"]);
  assert.equal(page.state, "Funded");
  const afterFunding = await say(id, seller.token, "Mình đã thấy tiền được khóa.");
  assert.ok(afterFunding.chainBlock >= page.events.at(-1).blockNumber, "A message sent after an event sorts after it");
  console.log("PASS verified chain events reach the thread");

  const form = new FormData();
  form.append("kind", "evidence");
  form.append("file", new Blob([pdf]), "bang-chung.pdf");
  const evidence = await request(`/orders/${id}/files`, buyer.token, "POST", form);
  await request(`/orders/${id}/chat`, seller.token, "POST", { fileId: evidence.id }, 400);
  const attached = await request(`/orders/${id}/chat`, buyer.token, "POST", { text: "Bằng chứng", fileId: evidence.id });
  assert.equal(attached.file.fileName, "bang-chung.pdf");
  assert.equal((await read(id, seller.token, `?afterSeq=${attached.seq - 1}`)).messages[0].file.id, evidence.id);
  console.log("PASS a party attaches its own evidence file");

  await act(id, buyer.token, "dispute"); await reach(id, "Disputed");
  page = await read(id, arbiter.token);
  assert.equal(page.role, "Arbiter");
  assert.equal(page.messages.length, 4);
  assert.equal((await request("/orders/chat/unread", arbiter.token)).find((row: any) => row.draftId === id).count, 4);
  assert.equal((await say(id, arbiter.token, "Tôi đã vào, hai bên gửi bằng chứng.")).senderRole, "Arbiter");
  await act(id, arbiter.token, "resolve", 5000); await reach(id, "Resolved");
  page = await read(id, buyer.token);
  assert.equal(page.canSend, false);
  assert.equal(page.events.at(-1).name, "Resolved");
  assert.equal(code(await request(`/orders/${id}/chat`, buyer.token, "POST", { text: "Muộn rồi" }, 409)), "CHAT_READ_ONLY");
  assert.equal(code(await request(`/orders/${id}/chat`, arbiter.token, "POST", { text: "Muộn rồi" }, 409)), "CHAT_READ_ONLY");
  assert.equal((await read(id, arbiter.token)).messages.length, 5);
  console.log("PASS the Arbiter joins at the dispute, and a resolved order is read only");

  const active = await draft("Trang giới thiệu cho câu lạc bộ");
  await fund(active);
  for (const [token, text] of [[buyer.token, "Mình gửi thêm yêu cầu: cần có trang liên hệ."], [seller.token, "Được, mình thêm vào."], [buyer.token, "Thanks bạn. Liên hệ zalo được không?"], [seller.token, "Mình trao đổi ở đây để có căn cứ nhé."]] as const)
    await say(active, token, text);
  console.log(`CHAT_DEMO ${JSON.stringify({ order: active, buyer: buyer.email, seller: seller.email })}`);

  if (process.env.SMOKE_CHAT_PERF_DB) {
    const database = process.env.SMOKE_CHAT_PERF_DB;
    assert.ok(/^StudentEscrow\w*Test$/.test(database), "Performance seeding only runs on a database named as a test database");
    const perf = await draft("Đo hiệu năng");
    await say(perf, buyer.token, "Tin đầu");
    const query = `SET NOCOUNT ON; DECLARE @d uniqueidentifier='${perf}';
      INSERT INTO ChatMessage (DraftId, Seq, SenderUserId, SenderRole, Text, FileId, ChainBlock, CreatedAt)
      SELECT TOP 5000 @d, 1 + ROW_NUMBER() OVER (ORDER BY (SELECT NULL)), m.SenderUserId, m.SenderRole, REPLICATE(N'tin nhắn ', 20), NULL, 0, SYSDATETIMEOFFSET()
      FROM sys.all_objects a CROSS JOIN sys.all_objects b CROSS JOIN (SELECT SenderUserId, SenderRole FROM ChatMessage WHERE DraftId=@d AND Seq=1) m;`;
    execFileSync("sqlcmd", ["-S", ".\\MINHKIEN1", "-E", "-b", "-d", database, "-Q", query], { stdio: "pipe" });
    const timed = async (action: () => Promise<unknown>) => { const start = performance.now(); await action(); return performance.now() - start; };
    assert.equal((await read(perf, buyer.token)).latestSeq, 5001);
    console.log("PERF order with 5,001 messages:");
    const idle: number[] = [];
    for (let i = 0; i < 40; i++) idle.push(await timed(() => read(perf, buyer.token, "?afterSeq=5001")));
    report("poll with nothing new, one at a time", idle);
    const first: number[] = [];
    for (let i = 0; i < 10; i++) first.push(await timed(() => read(perf, seller.token)));
    report("opening the order, newest 100 messages", first);
    const burst = (await Promise.all(Array.from({ length: 60 }, (_, index) => timed(() => read(perf, index % 2 ? buyer.token : seller.token, "?afterSeq=5001"))))).slice();
    report("60 polls at the same moment", burst);
    const sends = await Promise.all(Array.from({ length: 10 }, (_, index) => timed(() => say(perf, seller.token, `Đồng thời ${index}`))));
    report("10 messages sent at the same moment", sends);
    const seqs = (await read(perf, buyer.token, "?afterSeq=5001")).messages.map((item: any) => item.seq);
    assert.deepEqual(seqs, Array.from({ length: 10 }, (_, index) => 5002 + index));
    console.log("  concurrent sends kept gapless numbers");

    // End to end, as the browser does it: the reader asks every 3 seconds.
    let cursor = 5011;
    let stop = false;
    const seen = new Map<string, number>();
    const reader = (async () => {
      while (!stop) {
        const rows = (await read(perf, seller.token, `?afterSeq=${cursor}`)).messages;
        for (const row of rows) { seen.set(row.text, performance.now()); cursor = Math.max(cursor, row.seq); }
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    })();
    const delivered: number[] = [];
    for (let i = 0; i < 8; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 3000));
      const text = `Đo ${i}`;
      const start = performance.now();
      await say(perf, buyer.token, text);
      while (!seen.has(text)) await new Promise(resolve => setTimeout(resolve, 20));
      delivered.push(seen.get(text)! - start);
    }
    stop = true;
    await reader;
    report("from sending to the other side seeing it", delivered);
  }
  console.log("Chat smoke test passed.");
} finally {
  await connection.close();
}
