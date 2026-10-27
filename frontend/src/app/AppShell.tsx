import type { ReactNode } from "react";
import type { Session, NetworkStatus } from "../domain/types";
import type { useWallet } from "../infrastructure/wallet/useWallet";
import type { useWalletFunds } from "./useWalletFunds";
import { short } from "../domain/rules";
import { Icon } from "../shared/ui/Icon";
import { isAdminAccount } from "../domain/access";
export type WorkspaceTab = "orders" | "account" | "admin";
const titles = { orders: "Đơn hàng", account: "Tài khoản & ví", admin: "Quản trị" };
const descriptions = { orders: "Quản lý thỏa thuận, bàn giao và thanh toán của bạn.", account: "Thông tin cá nhân, ví thanh toán và xác minh tài khoản.", admin: "Xác minh ví và quản lý quyền truy cập trên blockchain." };
type Props = { children: ReactNode; session: Session | null; logout: () => void; tab: WorkspaceTab; setTab: (tab: WorkspaceTab) => void;
  wallet: ReturnType<typeof useWallet>; network: NetworkStatus; busy: boolean; checking: boolean; matched: boolean;
  expectedAddress: string | null; synchronize: () => Promise<void>; funds: ReturnType<typeof useWalletFunds> };
export default function AppShell({ children, session, logout, tab, setTab, wallet, network, busy, checking, matched, expectedAddress, synchronize, funds }: Props) {
  const admin = isAdminAccount(session);
  const tabs: WorkspaceTab[] = admin ? ["admin", "account"] : ["orders", "account"];
  if (!session) return <div className="login-shell"><header className="login-header"><div className="brand"><span className="brand-mark">S</span><strong>StudentEscrow</strong></div><span className="login-caption">Kết nối tin cậy. Hợp tác an tâm.</span></header><main id="workspace-main" className="login-main">{children}</main><footer className="login-footer">StudentEscrow · Ký quỹ dịch vụ sinh viên · ETH thử nghiệm</footer></div>;
  return <div className="app app-shell">
    <a className="skip-link" href="#workspace-main">Đến nội dung chính</a>
    <aside className="sidebar"><div className="brand"><span className="brand-mark">S</span><div><strong>StudentEscrow</strong><span>Ký quỹ dịch vụ sinh viên</span></div></div>
      <div><p className="nav-caption">{admin ? "QUẢN LÝ HỆ THỐNG" : "KHÔNG GIAN CỦA BẠN"}</p><nav className="sidebar-nav" aria-label="Chức năng">{tabs.map(item => <button key={item} aria-current={tab === item ? "page" : undefined} className={tab === item ? "active" : "secondary"} onClick={() => setTab(item)}><Icon name={item === "orders" ? "orders" : item === "account" ? "wallet" : "shield"} />{titles[item]}</button>)}</nav></div>
      <div className="sidebar-footer"><span className="environment-label">MẠNG THỬ NGHIỆM</span><p><span className={`connection-dot ${network.status === "Ready" ? "online" : ""}`} />{network.status === "Ready" ? "Blockchain đã kết nối" : "Đang chờ blockchain"}</p><details className="small"><summary>Chi tiết kết nối</summary><p>Blockchain: {network.status}</p><p>Chain 31337 · Block {network.lastIndexedBlock ?? "—"}</p><p className="mono">{network.contractAddress}</p></details></div>
    </aside>
    <div className="workspace"><header className="workspace-header"><div><p className="page-eyebrow">{admin ? "TRANG QUẢN TRỊ" : "STUDENT ESCROW"}</p><h1>{titles[tab]}</h1><p className="muted header-description">{descriptions[tab]}</p></div><div className="header-actions"><span className="user-avatar" aria-hidden="true">{session.user.fullName.slice(0, 1).toUpperCase()}</span><div className="user-summary"><strong>{session.user.fullName}</strong><span>{admin ? "Quản trị viên" : "Thành viên"}</span></div><button className="secondary" onClick={logout}>Đăng xuất</button></div></header>
      <section className="connection readiness-strip wallet-summary" aria-label="Ví thanh toán"><div className="wallet-identity"><span className="wallet-symbol"><Icon name="wallet" /></span><div><strong>{checking ? "Đang chuẩn bị ví…" : matched ? "Ví đã sẵn sàng" : !expectedAddress ? "Thiết lập ví thanh toán" : "Cần xác nhận ví"}</strong><div className="mono" title={expectedAddress ?? wallet.account}>{short(expectedAddress ?? wallet.account) || "Chưa liên kết ví"}</div>{wallet.account && !matched && <span className="muted">MetaMask đang chọn: <span className="mono" title={wallet.account}>{short(wallet.account)}</span></span>}</div></div><div className="wallet-metrics"><div><span>Số dư</span><strong>{funds ? `${funds.balance} ETH` : "—"}</strong></div><div><span>Giá gas hiện tại</span><strong>{funds ? `${funds.gasPrice} Gwei` : "—"}</strong></div></div><button className="secondary" disabled={busy} onClick={() => void synchronize()}>{checking ? "Chờ MetaMask…" : "Đồng bộ ví"}</button>{funds?.error && <p className="muted wallet-funds-error" role="status">{funds.error}</p>}</section>
      <main id="workspace-main" className="workspace-main" tabIndex={-1}>{children}</main>
      <footer className="workspace-footer"><span>StudentEscrow · ETH thử nghiệm</span><span>Mọi chữ ký và giao dịch đều cần bạn xác nhận trong MetaMask.</span></footer>
    </div>
  </div>;
}
