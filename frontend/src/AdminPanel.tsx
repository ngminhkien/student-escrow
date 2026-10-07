import { useEffect, useState } from "react";
import { address } from "./rules";
import { contractAt, errorMessage, sendTransaction } from "./wallet";
import type { NetworkStatus, RunAction, TxRecord } from "./types";

export default function AdminPanel({ account, canSign, network, busy, run, record, revision }: {
  account: string; canSign: boolean; network: NetworkStatus; busy: boolean; run: RunAction; record: (tx: TxRecord) => void; revision: number;
}) {
  const [kycAdmin, setKycAdmin] = useState(false);
  const [owner, setOwner] = useState(false);
  const [target, setTarget] = useState("");
  const [lookup, setLookup] = useState<{ address: string; verified: boolean; kycAdmin: boolean } | null>(null);
  const [role, setRole] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { setLookup(null); }, [account, network.deploymentId]);
  useEffect(() => {
    let stopped = false;
    setKycAdmin(false); setOwner(false);
    if (network.status !== "Ready" || !account) return;
    const refresh = async () => {
      try {
        const contract = contractAt(network);
        const [kycRole, adminRole] = await Promise.all([contract.KYC_ADMIN_ROLE(), contract.DEFAULT_ADMIN_ROLE()]);
        const [kyc, admin] = await Promise.all([contract.hasRole(kycRole, account), contract.hasRole(adminRole, account)]);
        if (!stopped) { setKycAdmin(kyc); setOwner(admin); setRole(kycRole); setError(""); }
      } catch (failure) { if (!stopped) setError(errorMessage(failure)); }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 10000);
    return () => { stopped = true; clearInterval(timer); };
  }, [account, network.status, network.deploymentId, revision]);
  async function inspect() {
    const value = address(target);
    const contract = contractAt(network);
    const [verified, admin] = await Promise.all([contract.verifiedWallets(value), contract.hasRole(await contract.KYC_ADMIN_ROLE(), value)]);
    setLookup({ address: value, verified, kycAdmin: admin });
  }
  async function verify(value: boolean) {
    await sendTransaction(account, network.deploymentId!, "setWalletVerified", [address(target), value], record);
    await inspect();
  }
  async function changeRole(grant: boolean) {
    await sendTransaction(account, network.deploymentId!, grant ? "grantRole" : "revokeRole", [role, address(target)], record);
    await inspect();
  }
  const ready = canSign && network.status === "Ready" && !busy;
  return <section className="panel narrow"><h2>Admin · xác minh ví on-chain</h2>
    <p>Quyền lấy trực tiếp từ contract của deployment hiện tại, không phải vai trò tự chọn trong tài khoản.</p>
    <dl><dt>Ví đang chọn</dt><dd className="mono">{account || "Chưa kết nối"}</dd><dt>KYC Admin</dt><dd>{kycAdmin ? "Có" : "Không"}</dd><dt>Quản trị phân quyền</dt><dd>{owner ? "Có" : "Không"}</dd></dl>
    {error && <p role="alert">{error}</p>}
    <label>Địa chỉ ví cần quản lý<input value={target} onChange={e => { setTarget(e.target.value); setLookup(null); }} placeholder="0x…" spellCheck={false} /></label>
    <div className="row"><button className="secondary" disabled={busy || network.status !== "Ready" || !target} onClick={() => void run("Tra cứu ví", inspect)}>Tra cứu</button>
      <button disabled={!ready || !kycAdmin || !target} onClick={() => void run("Xác minh ví on-chain", () => verify(true))}>Xác minh ví</button>
      <button className="secondary" disabled={!ready || !kycAdmin || !target} onClick={() => void run("Thu hồi xác minh", () => verify(false))}>Thu hồi xác minh</button></div>
    {lookup && <p className="banner"><span className="mono">{lookup.address}</span><br />Xác minh: {lookup.verified ? "Có" : "Không"} · KYC Admin: {lookup.kycAdmin ? "Có" : "Không"}</p>}
    <p className="muted">Xác minh là giao dịch cần gas. Thu hồi chặn tạo/nạp đơn mới, không ngăn thanh toán các đơn đã Funded.</p>
    <details><summary>Phân quyền KYC Admin</summary><p>Ví có DEFAULT_ADMIN_ROLE có thể cấp/thu hồi quyền xác minh cho ví khác.</p>
      <div className="row"><button disabled={!ready || !owner || !target || !role} onClick={() => void run("Cấp quyền KYC Admin", () => changeRole(true))}>Cấp quyền KYC Admin</button>
        <button className="secondary" disabled={!ready || !owner || !target || !role} onClick={() => void run("Thu hồi quyền KYC Admin", () => changeRole(false))}>Thu hồi quyền KYC Admin</button></div>
    </details>
  </section>;
}
