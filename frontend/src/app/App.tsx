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
import ChainExplorer from "../features/chain/ChainExplorer";
import AnalyticsPage from "../features/analytics/AnalyticsPage";
import ReceiptView from "../features/chain/ReceiptView";
import { ReceiptLink } from "../features/chain/ReceiptLink";
import TransactionJournal from "../features/transactions/TransactionJournal";
import AppShell from "./AppShell";
import type { WorkspaceTab } from "./AppShell";
import { useSession } from "./useSession";
import { useReadiness } from "./useReadiness";
import { isAdminAccount } from "../domain/access";
import { useWalletSession } from "./useWalletSession";
import { useWalletFunds } from "./useWalletFunds";
import { useWalletAccount } from "./useWalletAccount";
import WalletNotice from "./WalletNotice";
function readTransactions(): TxRecord[] {
  try { const value: unknown = JSON.parse(sessionStorage.getItem("escrow.transactions") ?? "[]"); return Array.isArray(value) ? value.filter((t): t is TxRecord => !!t && typeof t.hash === "string" && typeof t.address === "string" && typeof t.deploymentId === "string" && typeof t.status === "string" && typeof t.label === "string").slice(0, 30) : []; } catch { return []; }
}
const receiptInUrl = () => new URLSearchParams(location.search).get("tx");
export default function App() {
  const { session, changeSession, expired } = useSession();
  const [receipt, setReceipt] = useState(receiptInUrl);
  const [lastReceipt, setLastReceipt] = useState("");
  const [linkedState, setLinkedState] = useState<{ token: string; value: LinkedWallet } | null>(null);
  const linked = linkedState?.token === session?.accessToken ? linkedState?.value ?? null : null;
  const admin = isAdminAccount(session);
  const [selectedTab, setTab] = useState<WorkspaceTab>(receipt ? "chain" : session ? admin ? "admin" : "orders" : "account");
  const tab = !session ? "account" : (selectedTab === "admin" || selectedTab === "analytics") && !admin ? "orders" : selectedTab;
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [transactions, setTransactions] = useState(readTransactions);
  const running = useRef(false);
  const identity = session?.accessToken ?? "";
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  const wallet = useWallet();
  const { network, chainTime, tick } = useReadiness(revision);
  // Reloads screens on this user's own actions and on anything another party just put on the chain.
  const liveRevision = revision + tick;
  const custodial = !!linked?.custodial;
  // A custodial account signs on the server, so MetaMask stays out of it entirely.
  const account = custodial ? linked?.address ?? "" : wallet.account;
  const walletSession = useWalletSession(identity, custodial ? null : linked, wallet, !!busy);
  const funds = useWalletFunds(linked?.address ?? wallet.account, !!session && !custodial && !!linked && network.status === "Ready", liveRevision);
  const ledger = useWalletAccount(identity, custodial, liveRevision);
  const working = !!busy || walletSession.checking;
  useEffect(() => { setLinkedState(null); setNotice(""); setError(""); setLastReceipt(""); }, [identity]);
  useEffect(() => {
    const follow = () => { const value = receiptInUrl(); setReceipt(value); if (value) setTab("chain"); };
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, []);
  const closeReceipt = useCallback(() => {
    const url = new URL(location.href);
    if (url.searchParams.has("tx")) { url.searchParams.delete("tx"); history.pushState(null, "", url.pathname + url.search + url.hash); }
    setReceipt(null);
  }, []);
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
    running.current = true; setBusy(label); setError(""); setNotice(""); setLastReceipt("");
    try { await action(); if (currentIdentity.current === identity) setNotice(label + ": hoàn tất."); }
    catch (failure) { if (currentIdentity.current === identity && !options?.inlineError) setError(errorMessage(failure)); }
    finally { running.current = false; setBusy(""); setRevision(value => value + 1); }
  };
  const record = (transaction: TxRecord) => {
    if (transaction.phase === "confirmed") setLastReceipt(transaction.hash);
    setTransactions(previous => {
      const next = [transaction, ...previous.filter(t => t.hash !== transaction.hash)].slice(0, 30);
      try { sessionStorage.setItem("escrow.transactions", JSON.stringify(next)); } catch { /* Keep the journal in memory when browser storage is full. */ }
      return next;
    });
  };
  const visibleTransactions = transactions.filter(t => sameAddress(t.address, account) && t.deploymentId === network.deploymentId);
  async function checkTransactions() {
    for (const transaction of visibleTransactions) {
      const receipt = await rpc.getTransactionReceipt(transaction.hash);
      record({ ...transaction, status: receipt ? receipt.status === 1 ? "Đã xác nhận trên chain" : "Thất bại" : "Chưa có receipt (pending hoặc chain đã đổi)" });
    }
  }
  const canSign = custodial || (!!wallet.account && wallet.chainId === "31337" && !walletSession.checking);
  const matched = custodial || (!!linked?.linked && linked.chainId === 31337 && wallet.chainId === "31337" && sameAddress(linked.address, wallet.account));
  const walletReady = matched && canSign;
  function navigateTab(next: WorkspaceTab) {
    closeReceipt();
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
  return <AppShell session={session} logout={() => changeSession(null)} tab={tab} setTab={navigateTab} wallet={wallet} network={network} busy={working} checking={walletSession.checking} matched={matched} expectedAddress={linked?.address ?? null} synchronize={walletSession.synchronize} funds={funds} custodial={custodial} ledger={ledger}>
    {session && tab !== "chain" && <WalletNotice linked={linked} account={wallet.account} chainId={wallet.chainId} available={wallet.available} checking={walletSession.checking} ready={walletReady} />}
    {session && tab !== "chain" && walletSession.error && <p className="banner" role="alert">{walletSession.error}</p>}
    {session && tab !== "chain" && linked && !linked.linked && <div id="wallet-access-warning" className="banner onboarding-banner" role="alert"><div><strong>Hoàn tất thiết lập tài khoản</strong><p>Tài khoản chưa liên kết ví. Các nút chức năng đang bị khóa. Kết nối và ký liên kết ví một lần để bắt đầu sử dụng.</p></div><button className="secondary" onClick={() => setTab("account")}>Thiết lập ví</button></div>}
    {session && network.status !== "Ready" && <p className="banner">Kết nối blockchain chưa sẵn sàng. Bạn vẫn có thể xem tài khoản; các giao dịch sẽ mở khi kết nối được khôi phục.</p>}
    <div className="feedback" aria-live="polite">{busy && <p role="status">{busy}…{!custodial && " Nếu có yêu cầu ký, hãy mở MetaMask."}</p>}{(error || expired) && <p className="banner" role="alert">{error || "Phiên đăng nhập hết hạn. Đăng nhập lại để tiếp tục."}</p>}{notice && <p role="status">{notice}{lastReceipt && tab !== "chain" && <> <ReceiptLink hash={lastReceipt}>Xem biên lai</ReceiptLink></>}</p>}</div>
    {tab === "account" && (session ? <AccountPanel key={identity} session={session} account={account} canSign={canSign && !!linked && (!linked.linked || matched)} network={network} busy={working} run={run} onLinked={onLinked} revision={liveRevision} chooseWallet={wallet.changeAccount} ledger={ledger?.value} />
      : receipt ? <div className="receipt-public"><ReceiptView hash={receipt} network={network} standalone /><div className="receipt-public-note"><p>Ai có link này đều xem được biên lai, không cần tài khoản.</p><a className="button secondary" href={location.pathname}>Đăng nhập</a></div></div>
      : <AuthForm busy={!!busy} run={run} onSession={value => { changeSession(value); setTab(isAdminAccount(value) ? "admin" : "orders"); }} />)}
    {session && tab === "chain" && <ChainExplorer network={network} revision={liveRevision} token={identity} admin={admin} receipt={receipt} onCloseReceipt={closeReceipt} />}
    {session && <fieldset className="wallet-action-gate" disabled={!walletReady} aria-describedby={!walletReady ? "wallet-access-warning" : undefined}>
    <legend className="sr-only">Chức năng yêu cầu kết nối đúng ví tài khoản</legend>
    {session && tab === "orders" && <OrdersPanel key={identity} arbiterOnly={admin} session={session} account={account} canSign={canSign && matched} network={network} chainTime={chainTime} busy={working} run={run} record={record} revision={liveRevision} custodial={custodial} />}
    {session && admin && tab === "analytics" && <AnalyticsPage key={identity} token={identity} revision={revision} />}
    {session && admin && tab === "admin" && <AdminPanel key={identity} account={matched ? account : ""} canSign={canSign && matched} network={network} busy={working} run={run} record={record} revision={liveRevision} custodial={custodial} token={identity} />}
    {session && tab === "account" && !custodial && <details><summary>Lịch sử giao dịch ví</summary><TransactionJournal transactions={visibleTransactions} busy={working} run={run} check={checkTransactions} /></details>}
    </fieldset>}
  </AppShell>;
}
