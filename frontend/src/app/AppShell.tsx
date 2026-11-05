import type { ReactNode } from "react";
import type { Session, NetworkStatus } from "../domain/types";
import type { useWallet } from "../infrastructure/wallet/useWallet";
import type { useWalletFunds } from "./useWalletFunds";
import { short } from "../domain/rules";
import { Icon } from "../shared/ui/Icon";
import { isAdminAccount } from "../domain/access";
import WalletNetworkDiagnostics from "./WalletNetworkDiagnostics";
import type { useWalletAccount } from "./useWalletAccount";
import { formatEthAmount, formatVnd } from "../domain/money";
import { Copyable } from "../shared/ui/CopyButton";

export type WorkspaceTab = "orders" | "account" | "admin" | "chain";
const titles = { orders: "Đơn hàng", account: "Tài khoản & ví", admin: "Quản trị", chain: "Blockchain" };
const descriptions = {
  orders: "Mọi thỏa thuận, một nơi quản lý.",
  account: "Quản lý danh tính và ví giao dịch của bạn.",
  admin: "Kiểm soát quyền truy cập. Giữ giao dịch minh bạch.",
  chain: "Mỗi giao dịch trên chain có một biên lai để tra cứu và chia sẻ."
};
// The Admin only sees orders it arbitrates.
const titleOf = (item: WorkspaceTab, admin: boolean) => admin && item === "orders" ? "Phân xử" : titles[item];
type Props = {
  children: ReactNode; session: Session | null; logout: () => void; tab: WorkspaceTab;
  setTab: (tab: WorkspaceTab) => void; wallet: ReturnType<typeof useWallet>; network: NetworkStatus;
  busy: boolean; checking: boolean; matched: boolean; expectedAddress: string | null;
  synchronize: () => Promise<void>; funds: ReturnType<typeof useWalletFunds>;
  custodial?: boolean; ledger?: ReturnType<typeof useWalletAccount>;
};
function Brand() {
  return <div className="brand"><span className="brand-mark" aria-hidden="true"><Icon name="shield" size={22} /></span><div><strong>StudentEscrow<span className="brand-period">.</span></strong><span>Ký quỹ dịch vụ sinh viên</span></div></div>;
}
export default function AppShell({ children, session, logout, tab, setTab, wallet, network, busy, checking, matched, expectedAddress, synchronize, funds, custodial, ledger }: Props) {
  const admin = isAdminAccount(session);
  const tabs: WorkspaceTab[] = admin ? ["admin", "orders", "chain", "account"] : ["orders", "chain", "account"];
  if (!session) return <div className="login-shell">
    <a className="skip-link" href="#workspace-main">Đến nội dung chính</a>
    <header className="login-header"><Brand /><span className="environment-pill"><span className="connection-dot" />ETH thử nghiệm</span></header>
    <main id="workspace-main" className="login-main" tabIndex={-1}>{children}</main>
    <footer className="login-footer"><span>StudentEscrow © {new Date().getFullYear()}</span><span>Thỏa thuận rõ ràng. Giao dịch an tâm.</span></footer>
  </div>;
  return <div className="app app-shell">
    <a className="skip-link" href="#workspace-main">Đến nội dung chính</a>
    <aside className="sidebar">
      <Brand />
      <div className="navigation-block"><p className="nav-caption">{admin ? "ĐIỀU HÀNH" : "KHÔNG GIAN LÀM VIỆC"}</p>
        <nav className="sidebar-nav" aria-label="Chức năng">{tabs.map(item => <button key={item}
          aria-current={tab === item ? "page" : undefined} className={tab === item ? "active" : "secondary"} onClick={() => setTab(item)}>
          <Icon name={item === "orders" ? "orders" : item === "account" ? "wallet" : item === "chain" ? "blocks" : "shield"} />
          <span>{titleOf(item, admin)}</span>{tab === item && <span className="nav-indicator" aria-hidden="true" />}
        </button>)}</nav>
      </div>
      <div className="sidebar-footer"><p className="nav-caption">KẾT NỐI HỆ THỐNG</p>
        <p className="network-state"><span className={`connection-dot ${network.status === "Ready" ? "online" : ""}`} />{network.status === "Ready" ? "Blockchain đã kết nối" : "Đang chờ blockchain"}</p>
        <details><summary>Chi tiết kết nối</summary><p>Blockchain: {network.status}</p><p>Chain 31337 · Block {network.lastIndexedBlock ?? "—"}</p><p className="mono">{network.contractAddress}</p></details>
        <span className="environment-label">LOCAL ENVIRONMENT</span>
      </div>
    </aside>
    <div className="workspace">
      <header className="workspace-header">
        <div className="header-context"><span>Không gian làm việc</span><span aria-hidden="true">/</span><strong>{titleOf(tab, admin)}</strong></div>
        <div className="header-actions"><span className="user-avatar" aria-hidden="true">{session.user.fullName.slice(0, 1).toUpperCase()}</span>
          <div className="user-summary"><strong>{session.user.fullName}</strong><span>{admin ? "Quản trị viên" : "Thành viên"}</span></div>
          <button className="secondary logout-button" onClick={logout}><Icon name="logout" size={17} /><span>Đăng xuất</span></button>
        </div>
      </header>
      {tab !== "orders" && <div className="workspace-intro"><div><p className="page-eyebrow">{admin ? "ADMIN WORKSPACE" : "STUDENT ESCROW"}</p><h1>{titles[tab]}</h1><p>{descriptions[tab]}</p></div>
        <span className="workspace-tag"><Icon name={admin ? "shield" : "check"} size={16} />{admin ? "Quản trị hệ thống" : "Ký quỹ trên blockchain"}</span>
      </div>}
      {tab === "orders" && <h1 className="sr-only">{titleOf(tab, admin)}</h1>}
      {tab === "chain" ? null : custodial ? <section className="connection readiness-strip wallet-summary wallet-custodial" aria-label="Số dư tài khoản">
        <div className="wallet-identity"><span className="wallet-symbol"><Icon name="wallet" size={23} /></span><div>
          <span className="wallet-caption">SỐ DƯ KHẢ DỤNG</span>
          <strong data-testid="header-balance">{ledger?.value ? formatVnd(ledger.value.balanceWei) : "Đang tải…"}</strong>
          {expectedAddress && <Copyable value={expectedAddress} label="địa chỉ ví" display={short(expectedAddress)} />}
          {ledger?.error && <span className="muted" role="status">{ledger.error}</span>}
        </div></div>
        {ledger?.value && <div className="wallet-metrics"><div><span>Đang ký quỹ</span><strong>{formatVnd(ledger.value.lockedWei)}</strong></div><div><span>Quy đổi</span><strong title={ledger.value.balanceWei}>{formatEthAmount(ledger.value.balanceWei).replace(/^(\d+\.\d{5})\d+/, "$1…")}</strong></div></div>}
      </section> : <section className={`connection readiness-strip wallet-summary ${tab === "orders" ? "wallet-compact" : ""}`} aria-label="Ví thanh toán">
        <div className="wallet-identity"><span className="wallet-symbol"><Icon name="wallet" size={23} /></span><div>
          <span className="wallet-caption">VÍ GIAO DỊCH CỦA BẠN</span>
          <strong>{checking ? "Đang chuẩn bị ví…" : matched ? "Ví đã sẵn sàng" : !expectedAddress ? "Thiết lập ví thanh toán" : "Cần xác nhận ví"}</strong>
          {expectedAddress ?? wallet.account ? <Copyable value={(expectedAddress ?? wallet.account)!} label="địa chỉ ví" display={short(expectedAddress ?? wallet.account)} /> : <div className="mono">Chưa liên kết ví</div>}
          {wallet.account && !matched && <span className="muted">MetaMask đang chọn: <span className="mono" title={wallet.account}>{short(wallet.account)}</span></span>}
        </div></div>
        <div className="wallet-sync"><button className="secondary" disabled={busy} onClick={() => void synchronize()}><Icon name="refresh" size={16} />{checking ? "Chờ MetaMask…" : "Đồng bộ ví"}</button></div>
        <details className="wallet-more"><summary>Số dư & kết nối</summary>
        <div className="wallet-metrics"><div><span>Số dư khả dụng</span><strong title={funds?.balance}>{funds ? funds.balance.replace(/^(\d+\.\d{5})\d+$/, "$1…") : "—"}<small> ETH</small></strong></div>
          <div><span>Giá gas hiện tại</span><strong>{funds ? funds.gasPrice : "—"}<small> Gwei</small></strong></div>
        </div>
        {funds?.error && <p className="muted wallet-funds-error" role="status">{funds.error}</p>}
        <WalletNetworkDiagnostics network={network} account={wallet.account} busy={busy} />
        </details>
      </section>}
      <main id="workspace-main" className="workspace-main" tabIndex={-1}>{children}</main>
      <footer className="workspace-footer"><span>StudentEscrow · ETH thử nghiệm</span><span><Icon name="shield" size={14} />{custodial ? "Tỷ giá cố định 1 ETH = 100.000.000 ₫." : "Xác nhận trong MetaMask. Theo dõi ngay trên sàn."}</span></footer>
    </div>
  </div>;
}
