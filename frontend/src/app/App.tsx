import { useCallback, useEffect, useRef, useState } from "react";
import { getLinkedWallet } from "../services/account";
import { errorMessage } from "../infrastructure/wallet/transactions";
import { rpc, useWallet } from "../infrastructure/wallet/useWallet";
import { sameAddress } from "../domain/rules";
import type { LinkedWallet, RunAction, TxRecord } from "../domain/types";
import AccountPanel from "../AccountPanel";
import OrdersPanel from "../OrdersPanel";
import AdminPanel from "../AdminPanel";
import AuthForm from "../features/auth/AuthForm";
import TransactionJournal from "../features/transactions/TransactionJournal";
import AppShell from "./AppShell";
import type { WorkspaceTab } from "./AppShell";
import { useSession } from "./useSession";
import { useReadiness } from "./useReadiness";
function readTransactions(): TxRecord[] {
  try { const value: unknown = JSON.parse(sessionStorage.getItem("escrow.transactions") ?? "[]"); return Array.isArray(value) ? value.filter((t): t is TxRecord => !!t && typeof t.hash === "string" && typeof t.address === "string" && typeof t.deploymentId === "string" && typeof t.status === "string" && typeof t.label === "string").slice(0, 30) : []; } catch { return []; }
}
export default function App() {
  const { session, changeSession, expired } = useSession();
  const [linkedState, setLinkedState] = useState<{ token: string; value: LinkedWallet } | null>(null);
  const linked = linkedState?.token === session?.accessToken ? linkedState?.value : null;
  const [tab, setTab] = useState<WorkspaceTab>(session ? "orders" : "account");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [transactions, setTransactions] = useState(readTransactions);
  const running = useRef(false);
  const identity = session?.accessToken ?? "";
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  const wallet = useWallet();
  const { network, chainTime } = useReadiness(revision);
  useEffect(() => { setLinkedState(null); setNotice(""); setError(""); }, [identity]);
  useEffect(() => {
    if (!session) return;
    let active = true; let sequence = 0;
    const controller = new AbortController();
    const token = session.accessToken;
    const refresh = async () => {
      const requestId = ++sequence;
      try { const value = await getLinkedWallet(token, controller.signal); if (active && requestId === sequence && currentIdentity.current === token) setLinkedState({ token, value }); }
      catch (failure) { if (active && requestId === sequence && currentIdentity.current === token) { setLinkedState(null); setError(errorMessage(failure)); } }
    };
    void refresh(); window.addEventListener("focus", refresh);
    return () => { active = false; controller.abort(); window.removeEventListener("focus", refresh); };
  }, [identity, revision]);
  const onLinked = useCallback((value: LinkedWallet) => { if (currentIdentity.current === identity && identity) setLinkedState({ token: identity, value }); }, [identity]);
  const run: RunAction = async (label, action) => {
    if (running.current || currentIdentity.current !== identity) return;
    if (session && Date.now() >= new Date(session.expiresAt).getTime()) { changeSession(null); return; }
    running.current = true; setBusy(label); setError(""); setNotice("");
    try { await action(); if (currentIdentity.current === identity) setNotice(label + ": hoàn tất."); }
    catch (failure) { if (currentIdentity.current === identity) setError(errorMessage(failure)); }
    finally { running.current = false; setBusy(""); setRevision(value => value + 1); }
  };
  const record = (transaction: TxRecord) => setTransactions(previous => {
    const next = [transaction, ...previous.filter(t => t.hash !== transaction.hash)].slice(0, 30);
    try { sessionStorage.setItem("escrow.transactions", JSON.stringify(next)); } catch { /* Keep the journal in memory when browser storage is full. */ }
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
  return <AppShell session={session} logout={() => changeSession(null)} tab={tab} setTab={setTab} wallet={wallet} network={network} busy={!!busy} run={run}>
    {wallet.account && wallet.chainId !== "31337" && <p className="banner" role="alert">Sai mạng ({wallet.chainId || "chưa xác định"}). Cần chain 31337 trước khi ký.</p>}
    {linked?.linked && wallet.account && !matched && <p className="banner" role="alert">Ví đang chọn khác ví liên kết tài khoản: <span className="mono">{linked.address}</span>. Bấm “Đổi ví MetaMask” và chọn địa chỉ này. Đăng nhập ứng dụng không tự chuyển ví trong MetaMask.</p>}
    {network.status !== "Ready" && <p className="banner">Chưa thể gửi giao dịch. Kiểm tra node local, deploy contract và API có bật worker.</p>}
    <div className="feedback" aria-live="polite">{busy && <p role="status">{busy}… Nếu có yêu cầu ký, hãy mở MetaMask.</p>}{(error || expired) && <p className="banner" role="alert">{error || "Phiên đăng nhập hết hạn. Đăng nhập lại để tiếp tục."}</p>}{notice && <p role="status">{notice}</p>}</div>
    {tab === "account" && (session ? <AccountPanel key={identity} session={session} account={wallet.account} canSign={canSign} network={network} busy={!!busy} run={run} onLinked={onLinked} revision={revision} /> : <AuthForm busy={!!busy} run={run} onSession={value => { changeSession(value); setTab("orders"); }} />)}
    {tab === "orders" && (session ? <OrdersPanel key={identity} session={session} account={wallet.account} canSign={canSign && matched} network={network} chainTime={chainTime} busy={!!busy} run={run} record={record} revision={revision} /> : <section className="panel welcome-panel"><p className="page-eyebrow">GIAO DỊCH CÓ ĐIỀU KHOẢN RÕ RÀNG</p><h2>An tâm hợp tác.<br />Minh bạch từng bước.</h2><p>Tạo thỏa thuận, ký quỹ và nghiệm thu dịch vụ trên blockchain local. Bắt đầu bằng tài khoản ứng dụng của bạn.</p><button onClick={() => setTab("account")}>Đến đăng nhập</button><p className="muted">Tài khoản và ví MetaMask là hai bước riêng biệt.</p></section>)}
    {tab === "admin" && <AdminPanel account={wallet.account} canSign={canSign} network={network} busy={!!busy} run={run} record={record} revision={revision} />}
    <TransactionJournal transactions={visibleTransactions} busy={!!busy} run={run} check={checkTransactions} />
  </AppShell>;
}
