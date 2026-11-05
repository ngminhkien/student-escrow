import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { creditWallet, getAdminAccounts, setArbiterApproval, setWalletVerification } from "../../services/admin";
import { errorMessage, sendTransaction } from "../../wallet";
import { Copyable } from "../../shared/ui/CopyButton";
import { formatEthAmount, formatVnd, vndToWei, WEI_PER_VND } from "../../domain/money";
import type { AdminAccounts as Accounts, RunAction, TxRecord } from "../../types";

type Props = { token: string; busy: boolean; run: RunAction; revision: number; custodial: boolean; account: string; canSign: boolean; deploymentId: string; record: (tx: TxRecord) => void };

export default function AdminAccounts({ token, busy, run, revision, custodial: adminCustodial, account: adminAccount, canSign, deploymentId, record }: Props) {
  const [data, setData] = useState<Accounts | null>(null);
  const [error, setError] = useState("");
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState("10000000");
  // Stable across retries of the same credit, so a lost response cannot pay twice.
  const reference = useRef({ scope: "", id: "" });
  useEffect(() => {
    const controller = new AbortController();
    getAdminAccounts(token, controller.signal).then(value => { setData(value); setError(""); })
      .catch(failure => { if (!controller.signal.aborted) setError(errorMessage(failure)); });
    return () => controller.abort();
  }, [token, revision]);
  // The server signs for an Admin it holds a key for; an Admin on MetaMask signs in the wallet. Either way the contract checks the role.
  const setVerified = async (address: string, verified: boolean) => {
    if (adminCustodial) await setWalletVerification(token, address, verified);
    else await sendTransaction(adminAccount, deploymentId, "setWalletVerified", [address, verified], record);
  };
  const setArbiter = async (address: string, approved: boolean) => {
    if (adminCustodial) await setArbiterApproval(token, address, approved);
    else await sendTransaction(adminAccount, deploymentId, "setArbiterApproved", [address, approved], record);
  };
  const chainDisabled = busy || (!adminCustodial && !canSign);
  function credit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = String(new FormData(event.currentTarget).get("note") ?? "").trim();
    void run("Nạp tiền vào tài khoản", async () => {
      const amountVnd = Number(BigInt(vndToWei(amount)) / WEI_PER_VND);
      if (!Number.isSafeInteger(amountVnd)) throw new Error("Số tiền nằm ngoài giới hạn.");
      const scope = `${target}|${amountVnd}|${note}`;
      if (reference.current.scope !== scope) reference.current = { scope, id: crypto.randomUUID() };
      await creditWallet(token, { address: target, amountVnd, reference: reference.current.id, note: note || undefined });
      reference.current = { scope: "", id: "" };
    });
  }
  const custodial = data?.accounts.filter(account => account.custodial) ?? [];
  return <section className="panel admin-accounts" aria-label="Tài khoản người dùng">
    <div className="section-heading"><div><p className="page-eyebrow">TÀI KHOẢN NGƯỜI DÙNG</p><h2>Số dư và xác minh</h2></div></div>
    {error && <p role="alert" className="banner">{error}</p>}
    {data && <dl className="permission-grid"><div><dt>Tổng số dư sổ cái</dt><dd>{formatVnd(data.ledgerTotalWei)}</dd></div><div><dt>Đang khóa trong contract</dt><dd>{formatVnd(data.contractWei)}</dd></div><div><dt>Ví nền tảng (cấp phí gas)</dt><dd>{formatEthAmount(data.treasuryWei)}</dd></div></dl>}
    {data && <div className="order-list"><table className="ledger-table"><thead><tr><th>Tài khoản</th><th>Ví</th><th>Số dư</th><th>KYC</th><th>On-chain</th><th>Arbiter</th></tr></thead><tbody>{data.accounts.map(account => <tr key={account.userId}>
      <td data-label="Tài khoản"><strong>{account.fullName}</strong><div className="small muted">{account.email}</div></td>
      <td data-label="Ví" className="small"><Copyable value={account.address} label={`ví ${account.fullName}`} />{!account.custodial && <div className="muted">MetaMask</div>}</td>
      <td data-label="Số dư" className="amount">{account.custodial ? formatVnd(account.balanceWei) : "—"}</td>
      <td data-label="KYC">{account.kycStatus}</td>
      <td data-label="On-chain"><button className="secondary compact-button" disabled={chainDisabled} onClick={() => void run(account.verifiedOnChain ? "Thu hồi xác minh" : "Xác minh ví on-chain", () => setVerified(account.address, !account.verifiedOnChain))}>{account.verifiedOnChain ? "Thu hồi" : "Xác minh"}</button><div className="small muted">{account.verifiedOnChain ? "Đã xác minh" : "Chưa xác minh"}</div></td>
      <td data-label="Arbiter"><button className="secondary compact-button" disabled={chainDisabled} aria-label={`${account.approvedArbiter ? "Gỡ Arbiter" : "Thêm Arbiter"} ${account.fullName}`} onClick={() => void run(account.approvedArbiter ? "Gỡ Arbiter" : "Thêm Arbiter", () => setArbiter(account.address, !account.approvedArbiter))}>{account.approvedArbiter ? "Gỡ" : "Thêm"}</button><div className="small muted">{account.approvedArbiter ? "Trong danh sách" : "Không"}</div></td>
    </tr>)}</tbody></table></div>}
    {!!custodial.length && <form className="admin-credit" onSubmit={credit}><h3>Nạp tiền thủ công</h3><p className="muted">Ghi có vào sổ cái. Bản thử nghiệm trước khi có cổng thanh toán; mỗi lần nạp được lưu lại kèm người thực hiện.</p>
      <div className="grid three"><label>Tài khoản<select required value={target} onChange={event => setTarget(event.target.value)}><option value="">Chọn tài khoản</option>{custodial.map(account => <option key={account.userId} value={account.address}>{account.fullName} · {account.email}</option>)}</select></label>
        <label>Số tiền (VND)<input inputMode="numeric" required value={amount} onChange={event => setAmount(event.target.value)} /></label>
        <label>Ghi chú<input name="note" maxLength={200} /></label></div>
      <button disabled={busy || !target}>Nạp tiền</button></form>}
  </section>;
}
