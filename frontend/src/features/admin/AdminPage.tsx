import { useEffect, useRef, useState } from "react";
import { address } from "../../rules";
import { contractAt, errorMessage, sendTransaction } from "../../wallet";
import type { NetworkStatus, RunAction, TxRecord } from "../../types";

export interface AdminPageProps {
  account: string; canSign: boolean; network: NetworkStatus; busy: boolean; run: RunAction; record: (tx: TxRecord) => void; revision: number;
}
export default function AdminPage({ account, canSign, network, busy, run, record, revision }: AdminPageProps) {
  const [kycAdmin, setKycAdmin] = useState(false);
  const [owner, setOwner] = useState(false);
  const [target, setTarget] = useState("");
  const [lookup, setLookup] = useState<{ address: string; verified: boolean; kycAdmin: boolean } | null>(null);
  const [role, setRole] = useState("");
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const currentScope = useRef("");
  const scopeGeneration = useRef(0);
  const scope = JSON.stringify([account, network.deploymentId, network.status, target]);
  if (currentScope.current !== scope) scopeGeneration.current++;
  currentScope.current = scope;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; lookupGeneration.current++; }; }, []);
  const lookupGeneration = useRef(0);
  useEffect(() => { lookupGeneration.current++; setLookup(null); }, [account, network.deploymentId, network.status]);
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
    const generation = ++lookupGeneration.current;
    const value = address(target);
    const contract = contractAt(network);
    const [verified, admin] = await Promise.all([contract.verifiedWallets(value), contract.hasRole(await contract.KYC_ADMIN_ROLE(), value)]);
    if (generation === lookupGeneration.current) setLookup({ address: value, verified, kycAdmin: admin });
  }
  async function verify(value: boolean) {
    const assertScope = actionGuard();
    await sendTransaction(account, network.deploymentId!, "setWalletVerified", [address(target), value], record, assertScope);
    if (mounted.current && currentScope.current === scope) await inspect();
  }
  async function changeRole(grant: boolean) {
    const assertScope = actionGuard();
    await sendTransaction(account, network.deploymentId!, grant ? "grantRole" : "revokeRole", [role, address(target)], record, assertScope);
    if (mounted.current && currentScope.current === scope) await inspect();
  }
  function actionGuard() {
    const expectedScope = scope;
    const expectedGeneration = scopeGeneration.current;
    return () => {
      if (!mounted.current || currentScope.current !== expectedScope || scopeGeneration.current !== expectedGeneration)
        throw new Error("Ví, mạng hoặc địa chỉ quản lý đã thay đổi. Vui lòng bắt đầu lại.");
    };
  }
  const ready = canSign && network.status === "Ready" && !busy;
  return <section className="panel admin-panel"><h2>Quản trị xác minh</h2>
    <p>Quyền lấy trực tiếp từ contract của deployment hiện tại, không phải vai trò tự chọn trong tài khoản.</p>
    <dl><dt>Ví đang chọn</dt><dd className="mono">{account || "Chưa kết nối"}</dd><dt>KYC Admin</dt><dd>{kycAdmin ? "Có" : "Không"}</dd><dt>Quản trị phân quyền</dt><dd>{owner ? "Có" : "Không"}</dd></dl>
    {error && <p role="alert">{error}</p>}
    <label>Địa chỉ ví cần quản lý<input value={target} onChange={e => { lookupGeneration.current++; setTarget(e.target.value); setLookup(null); }} placeholder="0x…" spellCheck={false} /></label>
    <div className="row"><button className="secondary" disabled={busy || network.status !== "Ready" || !target} onClick={() => void run("Tra cứu ví", inspect)}>Tra cứu</button>
      <button disabled={!ready || !kycAdmin || !target || !lookup} onClick={() => void run("Xác minh ví on-chain", () => verify(true))}>Xác minh ví</button>
      <button className="secondary" disabled={!ready || !kycAdmin || !target || !lookup} onClick={() => void run("Thu hồi xác minh", () => verify(false))}>Thu hồi xác minh</button></div>
    {lookup && <p className="banner"><span className="mono">{lookup.address}</span><br />Xác minh: {lookup.verified ? "Có" : "Không"} · KYC Admin: {lookup.kycAdmin ? "Có" : "Không"}</p>}
    <p className="muted">Tra cứu địa chỉ để xem quyền và trạng thái hiện tại trước khi thay đổi. Xác minh là giao dịch cần gas. Thu hồi chặn tạo/nạp đơn mới, không ngăn thanh toán các đơn đã Funded.</p>
    <details><summary>Phân quyền KYC Admin</summary><p>Ví có DEFAULT_ADMIN_ROLE có thể cấp/thu hồi quyền xác minh cho ví khác.</p>
      <div className="row"><button disabled={!ready || !owner || !target || !role || !lookup} onClick={() => void run("Cấp quyền KYC Admin", () => changeRole(true))}>Cấp quyền KYC Admin</button>
        <button className="secondary" disabled={!ready || !owner || !target || !role || !lookup} onClick={() => void run("Thu hồi quyền KYC Admin", () => changeRole(false))}>Thu hồi quyền KYC Admin</button></div>
    </details>
  </section>;
}
