import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { api, health, loadSession, saveSession } from "./api";
import { errorMessage, pendingTimestamp, rpc, useWallet } from "./wallet";
import { sameAddress, short } from "./rules";
import type { LinkedWallet, NetworkStatus, RunAction, Session, TxRecord } from "./types";
import AccountPanel from "./AccountPanel";
import OrdersPanel from "./OrdersPanel";
import AdminPanel from "./AdminPanel";

function readTransactions(): TxRecord[] {
  try { return JSON.parse(sessionStorage.getItem("escrow.transactions") ?? "[]") as TxRecord[]; } catch { return []; }
}
export default function App() {
  const [session, setSession] = useState(loadSession);
  const [linked, setLinked] = useState<LinkedWallet | null>(null);
  const [tab, setTab] = useState("account");
  const [network, setNetwork] = useState<NetworkStatus>({ status: "Đang kiểm tra" });
  const [chainTime, setChainTime] = useState(0);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [transactions, setTransactions] = useState(readTransactions);
  const running = useRef(false);
  const wallet = useWallet();
  const changeSession = useCallback((value: Session | null) => {
    saveSession(value); setSession(value); setLinked(null); setTab("account"); setNotice(""); setError("");
  }, []);
  useEffect(() => {
    const expire = () => { changeSession(null); setError("Phiên đăng nhập hết hạn hoặc API vừa khởi động lại. Đăng nhập lại để tiếp tục."); };
    window.addEventListener("escrow:session-expired", expire);
    const timer = session ? window.setTimeout(expire, Math.max(0, new Date(session.expiresAt).getTime() - Date.now())) : undefined;
    return () => { window.removeEventListener("escrow:session-expired", expire); clearTimeout(timer); };
  }, [session, changeSession]);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function refresh() {
      const value = await health(controller.signal);
      if (stopped) return;
      setNetwork(value);
      try {
        const timestamp = value.status === "Ready" ? await pendingTimestamp() : 0;
        if (!stopped) setChainTime(timestamp);
      } catch { if (!stopped) setChainTime(0); }
      if (!stopped) timer = setTimeout(() => void refresh(), 5000);
    }
    void refresh();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [revision]);
  const run: RunAction = async (label, action) => {
    if (running.current) return;
    running.current = true; setBusy(label); setError(""); setNotice("");
    try { await action(); setNotice(`${label}: hoàn tất.`); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { running.current = false; setBusy(""); setRevision(value => value + 1); }
  };
  const record = (transaction: TxRecord) => setTransactions(previous => {
    const next = [transaction, ...previous.filter(t => t.hash !== transaction.hash)].slice(0, 30);
    sessionStorage.setItem("escrow.transactions", JSON.stringify(next));
    return next;
  });
  const visibleTransactions = transactions.filter(t => sameAddress(t.address, wallet.account) && t.deploymentId === network.deploymentId);
  async function checkTransactions() {
    for (const transaction of visibleTransactions) {
      const receipt = await rpc.getTransactionReceipt(transaction.hash);
      record({ ...transaction, status: receipt ? receipt.status === 1 ? "Đã xác nhận trên chain" : "Thất bại" : "Chưa có receipt (pending hoặc chain đã đổi)" });
    }
  }
  const canSign = !!wallet.account && wallet.chainId === "31337";
  const matched = !!linked?.linked && linked.chainId === 31337 && sameAddress(linked.address, wallet.account);
  return <div className="app">
    <header>
      <div><h1>StudentEscrow</h1><p>Ký quỹ dịch vụ sinh viên · Local · ETH test</p></div>
      <div className="header-actions">
        {session && <span>{session.user.email}</span>}
        {session && <button className="secondary" disabled={!!busy} onClick={() => changeSession(null)}>Đăng xuất</button>}
      </div>
    </header>
    <section className="connection" aria-label="Kết nối">
      <div><strong>Blockchain: {network.status}</strong><span className="muted"> · Block SQL {network.lastIndexedBlock ?? "—"}</span>
        {network.contractAddress && <div className="small mono" title={network.contractAddress}>Contract {network.contractAddress}</div>}</div>
      <div className="row">
        {wallet.account && <span className="mono" title={wallet.account}>{short(wallet.account)}</span>}
        <button disabled={!!busy} onClick={() => void run("Kết nối ví", wallet.connect)}>{wallet.account ? "Kết nối lại ví" : "Kết nối MetaMask"}</button>
        {wallet.chainId !== "31337" && <button className="secondary" disabled={!!busy || !wallet.available} onClick={() => void run("Chuyển mạng", wallet.switchNetwork)}>Chuyển sang mạng local</button>}
      </div>
    </section>
    {wallet.account && wallet.chainId !== "31337" && <p className="banner" role="alert">Sai mạng ({wallet.chainId || "chưa xác định"}). Cần chain 31337 trước khi ký.</p>}
    {linked?.linked && wallet.account && !matched && <p className="banner" role="alert">Ví đang chọn khác ví liên kết tài khoản: <span className="mono">{linked.address}</span>. Chuyển đúng ví hoặc đăng nhập tài khoản tương ứng.</p>}
    {network.status !== "Ready" && <p className="banner">Chưa thể gửi giao dịch. Kiểm tra node local, deploy contract và API có bật worker. <a href="http://localhost:5180/swagger" target="_blank" rel="noreferrer">Mở Swagger</a></p>}
    <nav aria-label="Chức năng">
      <button className={tab === "account" ? "active" : "secondary"} onClick={() => setTab("account")}>Tài khoản & ví</button>
      <button className={tab === "orders" ? "active" : "secondary"} onClick={() => setTab("orders")}>Đơn hàng</button>
      <button className={tab === "admin" ? "active" : "secondary"} onClick={() => setTab("admin")}>Admin</button>
    </nav>
    <div className="feedback" aria-live="polite">
      {busy && <p role="status">{busy}… Nếu có yêu cầu ký, hãy mở MetaMask.</p>}
      {error && <p className="banner" role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </div>
    <main>
      {tab === "account" && (session
        ? <AccountPanel key={session.user.id} session={session} account={wallet.account} canSign={canSign} network={network}
            busy={!!busy} run={run} onLinked={setLinked} revision={revision} />
        : <AuthForm busy={!!busy} run={run} onSession={changeSession} />)}
      {tab === "orders" && (session
        ? <OrdersPanel key={session.user.id} session={session} account={wallet.account} canSign={canSign && matched}
            network={network} chainTime={chainTime} busy={!!busy} run={run} record={record} revision={revision} />
        : <section className="panel"><h2>Đơn hàng</h2><p>Đăng nhập, liên kết ví rồi tạo hoặc xem đơn của bạn.</p><button onClick={() => setTab("account")}>Đến đăng nhập</button></section>)}
      {tab === "admin" && <AdminPanel account={wallet.account} canSign={canSign} network={network} busy={!!busy} run={run} record={record} revision={revision} />}
    </main>
    {visibleTransactions.length > 0 && <details className="panel transactions"><summary>Giao dịch của ví hiện tại ({visibleTransactions.length})</summary>
      <button className="secondary" disabled={!!busy} onClick={() => void run("Kiểm tra giao dịch", checkTransactions)}>Kiểm tra receipt</button>
      <ul>{visibleTransactions.map(tx => <li key={tx.hash}><strong>{tx.label}</strong> · {tx.status}<div className="mono small">{tx.hash}</div></li>)}</ul>
      <p className="muted">Xác nhận giao dịch và trạng thái SQL có thể cập nhật lệch vài giây. Nếu đang chờ, kiểm tra receipt trước khi gửi lại.</p>
    </details>}
    <footer>Phần 4–5 · Demo local. Dùng ví thử nghiệm. Giao dịch được ký trong MetaMask.</footer>
  </div>;
}

function AuthForm({ busy, run, onSession }: { busy: boolean; run: RunAction; onSession: (session: Session) => void }) {
  const [register, setRegister] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(register ? "Đăng ký" : "Đăng nhập", async () => {
      const result = await api<Session>(register ? "/auth/register" : "/auth/login", undefined, "POST", {
        email: String(data.get("email")).trim(), password: data.get("password"), ...(register ? { fullName: data.get("fullName") } : {}) });
      onSession(result);
    });
  }
  return <section className="panel narrow"><h2>{register ? "Tạo tài khoản" : "Đăng nhập"}</h2>
    <p>Tài khoản ứng dụng và ví MetaMask là hai bước riêng. Mỗi tài khoản liên kết một ví.</p>
    <form onSubmit={submit}>
      {register && <label>Họ tên<input name="fullName" minLength={2} maxLength={100} required autoComplete="name" /></label>}
      <label>Email<input name="email" type="email" required maxLength={254} autoComplete="email" /></label>
      <label>Mật khẩu<input name="password" type="password" minLength={register ? 10 : 1} maxLength={128} required autoComplete={register ? "new-password" : "current-password"} /></label>
      <button disabled={busy}>{register ? "Đăng ký" : "Đăng nhập"}</button>
    </form>
    <button className="text-button" disabled={busy} onClick={() => setRegister(v => !v)}>{register ? "Đã có tài khoản? Đăng nhập" : "Chưa có tài khoản? Đăng ký"}</button>
  </section>;
}
