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
import { isAdminAccount } from "../domain/access";
import { useWalletSession } from "./useWalletSession";
import { useWalletFunds } from "./useWalletFunds";
import WalletNotice from "./WalletNotice";
function readTransactions(): TxRecord[] {
  try { const value: unknown = JSON.parse(sessionStorage.getItem("escrow.transactions") ?? "[]"); return Array.isArray(value) ? value.filter((t): t is TxRecord => !!t && typeof t.hash === "string" && typeof t.address === "string" && typeof t.deploymentId === "string" && typeof t.status === "string" && typeof t.label === "string").slice(0, 30) : []; } catch { return []; }
}
export default function App() {
  const { session, changeSession, expired } = useSession();
  const [linkedState, setLinkedState] = useState<{ token: string; value: LinkedWallet } | null>(null);
  const linked = linkedState?.token === session?.accessToken ? linkedState?.value ?? null : null;
  const admin = isAdminAccount(session);
  const [selectedTab, setTab] = useState<WorkspaceTab>(session ? admin ? "admin" : "orders" : "account");
  const tab = !session ? "account" : selectedTab === "account" ? "account" : admin ? "admin" : "orders";
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
  const walletSession = useWalletSession(identity, linked, wallet, !!busy);
  const funds = useWalletFunds(linked?.address ?? wallet.account, !!session && network.status === "Ready");
  const working = !!busy || walletSession.checking;
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
  const run: RunAction = async (label, action, options) => {
    if (running.current || currentIdentity.current !== identity) return;
    if (session && Date.now() >= new Date(session.expiresAt).getTime()) { changeSession(null); return; }
    running.current = true; setBusy(label); setError(""); setNotice("");
    try { await action(); if (currentIdentity.current === identity) setNotice(label + ": hoàn tất."); }
    catch (failure) { if (currentIdentity.current === identity && !options?.inlineError) setError(errorMessage(failure)); }
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
  const canSign = !!wallet.account && wallet.chainId === "31337" && !walletSession.checking;
  const matched = !!linked?.linked && linked.chainId === 31337 && wallet.chainId === "31337" && sameAddress(linked.address, wallet.account);
  const walletReady = matched && canSign;
  function navigateTab(next: WorkspaceTab) {
    if (next === "orders") {
      const url = new URL(location.href);
      if (url.searchParams.has("order") || url.searchParams.has("create")) {
        url.searchParams.delete("order"); url.searchParams.delete("create");
        history.pushState(null, "", url.pathname + url.search + url.hash);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }
    }
    setTab(next);
  }
  return <AppShell session={session} logout={() => changeSession(null)} tab={tab} setTab={navigateTab} wallet={wallet} network={network} busy={working} checking={walletSession.checking} matched={matched} expectedAddress={linked?.address ?? null} synchronize={walletSession.synchronize} funds={funds}>
    {session && <WalletNotice linked={linked} account={wallet.account} chainId={wallet.chainId} available={wallet.available} checking={walletSession.checking} ready={walletReady} />}
    {session && walletSession.error && <p className="banner" role="alert">{walletSession.error}</p>}
    {session && linked && !linked.linked && <div id="wallet-access-warning" className="banner onboarding-banner" role="alert"><div><strong>Hoàn tất thiết lập tài khoản</strong><p>Tài khoản chưa liên kết ví. Các nút chức năng đang bị khóa. Kết nối và ký liên kết ví một lần để bắt đầu sử dụng.</p></div><button className="secondary" onClick={() => setTab("account")}>Thiết lập ví</button></div>}
    {session && network.status !== "Ready" && <p className="banner">Kết nối blockchain chưa sẵn sàng. Bạn vẫn có thể xem tài khoản; các giao dịch sẽ mở khi kết nối được khôi phục.</p>}
    <div className="feedback" aria-live="polite">{busy && <p role="status">{busy}… Nếu có yêu cầu ký, hãy mở MetaMask.</p>}{(error || expired) && <p className="banner" role="alert">{error || "Phiên đăng nhập hết hạn. Đăng nhập lại để tiếp tục."}</p>}{notice && <p role="status">{notice}</p>}</div>
    {tab === "account" && (session ? <AccountPanel key={identity} session={session} account={wallet.account} canSign={canSign && !!linked && (!linked.linked || matched)} network={network} busy={working} run={run} onLinked={onLinked} revision={revision} chooseWallet={wallet.changeAccount} /> : <AuthForm busy={!!busy} run={run} onSession={value => { changeSession(value); setTab(isAdminAccount(value) ? "admin" : "orders"); }} />)}
    {session && <fieldset className="wallet-action-gate" disabled={!walletReady} aria-describedby={!walletReady ? "wallet-access-warning" : undefined}>
    <legend className="sr-only">Chức năng yêu cầu kết nối đúng ví tài khoản</legend>
    {session && !admin && tab === "orders" && <OrdersPanel key={identity} session={session} account={wallet.account} canSign={canSign && matched} network={network} chainTime={chainTime} busy={working} run={run} record={record} revision={revision} />}
    {session && admin && tab === "admin" && <AdminPanel key={identity} account={matched ? wallet.account : ""} canSign={canSign && matched} network={network} busy={working} run={run} record={record} revision={revision} />}
    {session && tab === "account" && <details><summary>Lịch sử giao dịch ví</summary><TransactionJournal transactions={visibleTransactions} busy={working} run={run} check={checkTransactions} /></details>}
    </fieldset>}
  </AppShell>;
}
