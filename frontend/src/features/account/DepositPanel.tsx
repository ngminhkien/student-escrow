import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Deposit, DepositStatus, RunAction } from "../../domain/types";
import { DEPOSIT_MAX_VND, DEPOSIT_MIN_VND, formatEthAmount, formatVnd, parseDepositVnd, WEI_PER_VND } from "../../domain/money";
import { cancelDeposit, createDeposit, listDeposits, payMockDeposit, retryDepositPayout } from "../../services/account";
import { formatDate } from "../../shared/format";
import { errorMessage } from "../../wallet";
import { Copyable } from "../../shared/ui/CopyButton";
import { TxHash } from "../chain/ReceiptLink";

const PRESETS = [100_000, 500_000, 1_000_000, 5_000_000];
const statusLabels: Record<DepositStatus, string> = { Pending: "Đang chờ", Succeeded: "Thành công", Failed: "Thất bại", Cancelled: "Đã hủy", Expired: "Hết hạn" };
const display = (vnd: number) => formatVnd(BigInt(vnd) * WEI_PER_VND);
const code = (deposit: Deposit) => deposit.id.slice(0, 8).toUpperCase();
const QUEUED_MESSAGE = "Đã nhận thanh toán nhưng chưa gửi được ETH vào ví. Bấm Gửi lại ETH khi blockchain sẵn sàng.";
const LEDGER_QUEUED_MESSAGE = "Đã cộng vào số dư nhưng ETH chưa được ghi lên chain. Bấm Gửi lại ETH khi blockchain sẵn sàng.";
const UNKNOWN_MESSAGE = "Đã nhận thanh toán nhưng chưa rõ ETH đã đến ví chưa. Hệ thống không tự gửi lại để tránh trả hai lần. Hãy kiểm tra số dư ví và liên hệ hỗ trợ nếu chưa nhận được.";
const statusText = (deposit: Deposit, selfHeld: boolean) => deposit.payoutStatus === "Sent" ? selfHeld ? "Đã gửi vào ví" : statusLabels[deposit.status] : deposit.payoutStatus === "Queued" ? "Chờ gửi ETH" : deposit.payoutStatus === "Sending" ? "Cần kiểm tra" : statusLabels[deposit.status];

// walletAddress is set for a self-held wallet, which has only the ETH it receives. A custodial wallet also has a ledger balance.
export default function DepositPanel({ token, busy, run, revision, walletAddress = null }: { token: string; busy: boolean; run: RunAction; revision: number; walletAddress?: string | null }) {
  const [amount, setAmount] = useState("");
  const [deposits, setDeposits] = useState<Deposit[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  // Kept across retries so a lost response cannot open a second request; a different amount is a different request.
  const reference = useRef(crypto.randomUUID());
  useEffect(() => {
    const controller = new AbortController();
    listDeposits(token, controller.signal).then(value => { setDeposits(value); setLoadError(""); })
      .catch(failure => { if (!controller.signal.aborted) setLoadError(errorMessage(failure)); });
    return () => controller.abort();
  }, [token, revision]);
  const active = deposits?.find(item => item.status === "Pending");
  const unsent = deposits?.find(item => item.payoutStatus === "Queued");
  const unchanged = walletAddress ? "Ví của bạn không thay đổi." : "Số dư không thay đổi.";
  const attempt = (label: string, action: () => Promise<void>) => {
    setError(""); setResult("");
    return run(label, async () => {
      try { await action(); }
      catch (failure) { setError(errorMessage(failure)); throw failure; }
    }, { inlineError: true });
  };
  const replace = (next: Deposit) => setDeposits(previous => [next, ...(previous ?? []).filter(item => item.id !== next.id)]);
  function changeAmount(value: string) {
    setAmount(value); setError(""); reference.current = crypto.randomUUID();
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void attempt("Tạo yêu cầu nạp", async () => {
      const created = await createDeposit(token, { amountVnd: parseDepositVnd(amount), reference: reference.current });
      replace(created); setAmount(""); reference.current = crypto.randomUUID();
    });
  }
  const pay = (deposit: Deposit, outcome: "Succeeded" | "Failed") => void attempt("Thanh toán giả lập", async () => {
    const paid = await payMockDeposit(token, deposit.id, outcome);
    replace(paid);
    if (paid.status !== "Succeeded") setResult(`Thanh toán thất bại. ${unchanged}`);
    else reportPayout(paid);
  });
  const reportPayout = (deposit: Deposit) => {
    if (deposit.payoutStatus === "Queued") setError(walletAddress ? QUEUED_MESSAGE : LEDGER_QUEUED_MESSAGE);
    else if (deposit.payoutStatus === "Sending") setError(UNKNOWN_MESSAGE);
    else {
      const hash = deposit.payoutTransactionHash ? ` Mã giao dịch: ${deposit.payoutTransactionHash}` : "";
      setResult(walletAddress ? `Đã gửi ${formatEthAmount(deposit.amountWei)} vào ví của bạn.${hash}` : `Đã nạp ${display(deposit.amountVnd)} vào số dư.${hash}`);
    }
  };
  const retry = (deposit: Deposit) => void attempt("Gửi lại ETH", async () => {
    const next = await retryDepositPayout(token, deposit.id);
    replace(next); reportPayout(next);
  });
  const cancel = (deposit: Deposit) => void attempt("Hủy yêu cầu nạp", async () => {
    replace(await cancelDeposit(token, deposit.id));
    setResult(`Đã hủy yêu cầu nạp. ${unchanged}`);
  });

  return <section className="panel deposit-panel" aria-label="Nạp tiền"><h2>Nạp tiền</h2>
    {active ? <div className="mock-gateway" role="group" aria-label="Cổng thanh toán giả lập">
      <p className="mock-gateway-badge">Cổng thanh toán giả lập</p>
      <p className="small muted">Bản demo: không có tiền thật nào được chuyển. Bạn tự chọn kết quả thanh toán.</p>
      <dl><dt>Mã yêu cầu</dt><dd className="mono">{code(active)}</dd><dt>Số tiền</dt><dd data-testid="deposit-amount"><strong>{display(active.amountVnd)}</strong></dd>{walletAddress && active.payoutAddress && <><dt>ETH nhận được</dt><dd>{formatEthAmount(active.amountWei)}</dd><dt>Ví nhận</dt><dd><Copyable value={active.payoutAddress} label="ví nhận" /></dd></>}<dt>Hết hạn lúc</dt><dd>{formatDate(active.expiresAt)}</dd></dl>
      <div className="mock-gateway-actions">
        <button type="button" disabled={busy} onClick={() => pay(active, "Succeeded")}>Thanh toán thành công</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => pay(active, "Failed")}>Thanh toán thất bại</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => cancel(active)}>Hủy yêu cầu</button>
      </div>
    </div> : <form className="deposit-form" onSubmit={submit}>
      <label>Số tiền (VND)<input name="depositAmount" inputMode="numeric" autoComplete="off" required value={amount} onChange={event => changeAmount(event.target.value)} placeholder="100.000" /></label>
      <div className="deposit-presets" role="group" aria-label="Chọn nhanh số tiền">{PRESETS.map(value => <button key={value} type="button" className="secondary" disabled={busy} onClick={() => changeAmount(String(value))}>{display(value)}</button>)}</div>
      <p className="small muted">Mỗi lần nạp từ {display(DEPOSIT_MIN_VND)} đến {display(DEPOSIT_MAX_VND)}. Yêu cầu có hiệu lực 15 phút.</p>
      {walletAddress && <p className="small muted">ETH được gửi thẳng vào ví <Copyable value={walletAddress} label="ví của bạn" /> theo tỷ giá cố định, không qua sổ cái. Bạn trả phí gas từ số ETH này, nên hãy nạp dư một ít.</p>}
      <button disabled={busy || !amount.trim()}>Tiếp tục</button>
    </form>}
    {unsent && !active && <button type="button" className="secondary" disabled={busy} onClick={() => retry(unsent)}>Gửi lại ETH</button>}
    {error && <p className="banner" role="alert">{error}</p>}
    {result && <p className="deposit-result" role="status">{result}</p>}
    {loadError && <p className="banner" role="alert">Chưa tải được lịch sử nạp: {loadError}</p>}
    {!!deposits?.length && <div className="deposit-history"><h3>Yêu cầu gần đây</h3><div className="order-list"><table className="ledger-table"><thead><tr><th>Thời gian</th><th>Mã</th><th>Số tiền</th><th>Trạng thái</th></tr></thead><tbody>{deposits.map(item => <tr key={item.id}>
      <td data-label="Thời gian">{formatDate(item.createdAt)}</td><td data-label="Mã" className="mono small">{code(item)}</td>
      <td data-label="Số tiền" className="amount">{display(item.amountVnd)}</td><td data-label="Trạng thái">{statusText(item, !!walletAddress)}{item.payoutTransactionHash && <div className="small"><TxHash hash={item.payoutTransactionHash} /></div>}</td>
    </tr>)}</tbody></table></div></div>}
  </section>;
}
