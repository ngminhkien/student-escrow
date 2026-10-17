import type { ReactNode } from "react";
import type { Session, NetworkStatus, RunAction } from "../domain/types";
import type { useWallet } from "../infrastructure/wallet/useWallet";
import { short } from "../domain/rules";
import { Icon } from "../shared/ui/Icon";
export type WorkspaceTab = "orders" | "account" | "admin";
const titles = { orders: "Đơn hàng", account: "Tài khoản & ví", admin: "Quản trị blockchain" };
export default function AppShell({ children, session, logout, tab, setTab, wallet, network, busy, run }: { children: ReactNode; session: Session | null; logout: () => void; tab: WorkspaceTab; setTab: (tab: WorkspaceTab) => void; wallet: ReturnType<typeof useWallet>; network: NetworkStatus; busy: boolean; run: RunAction }) {
  return <div className="app app-shell">
    <a className="skip-link" href="#workspace-main">Đến nội dung chính</a>
    <aside className="sidebar"><div className="brand"><span className="brand-mark">S</span><div><strong>StudentEscrow</strong><span>Ký quỹ dịch vụ sinh viên</span></div></div>
      <nav className="sidebar-nav" aria-label="Chức năng">{(["orders", "account", "admin"] as const).map(item => <button key={item} aria-current={tab === item ? "page" : undefined} className={tab === item ? "active" : "secondary"} onClick={() => setTab(item)}><Icon name={item === "orders" ? "orders" : item === "account" ? "wallet" : "shield"} />{titles[item]}</button>)}</nav>
      <div className="sidebar-footer"><span className="environment-label">MÔI TRƯỜNG LOCAL</span><p>ETH thử nghiệm · Chain 31337</p><p>Giao dịch được ký trong MetaMask.</p></div>
    </aside>
    <div className="workspace"><header className="workspace-header"><div><p className="page-eyebrow">KHÔNG GIAN LÀM VIỆC</p><h1>{titles[tab]}</h1></div><div className="header-actions">{session && <><span>{session.user.email}</span><button className="secondary" onClick={logout}>Đăng xuất</button></>}</div></header>
      <section className="connection readiness-strip" aria-label="Kết nối"><div><strong>Blockchain: {network.status}</strong><span className="muted"> · Block SQL {network.lastIndexedBlock ?? "—"}</span>{network.contractAddress && <div className="small mono" title={network.contractAddress}>Contract {network.contractAddress}</div>}</div><div className="row wallet-controls">{wallet.account && <span className="mono" title={wallet.account}>MetaMask: {short(wallet.account)}</span>}<button disabled={busy} onClick={() => void run("Kết nối ví", wallet.connect)}>{wallet.account ? "Kết nối lại ví" : "Kết nối MetaMask"}</button>{wallet.account && <button className="secondary" disabled={busy} onClick={() => void run("Chọn ví MetaMask", wallet.changeAccount)}>Đổi ví MetaMask</button>}{wallet.chainId !== "31337" && <button className="secondary" disabled={busy || !wallet.available} onClick={() => void run("Chuyển mạng", wallet.switchNetwork)}>Chuyển sang mạng local</button>}</div></section>
      <main id="workspace-main" className="workspace-main" tabIndex={-1}>{children}</main>
      <footer><details className="technical-details"><summary>Thông tin môi trường thử nghiệm</summary><p>Ứng dụng cần API, SQL Server, blockchain local và worker đồng bộ. KYC demo tách biệt với quyền xác minh on-chain.</p><a href="http://localhost:5180/swagger" target="_blank" rel="noreferrer">Mở tài liệu API</a></details></footer>
    </div>
  </div>;
}
