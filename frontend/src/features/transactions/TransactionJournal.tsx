import type { RunAction, TxRecord } from "../../domain/types";
export default function TransactionJournal({ transactions, busy, run, check }: { transactions: TxRecord[]; busy: boolean; run: RunAction; check: () => Promise<void> }) {
  if (!transactions.length) return null;
  return <details className="panel transactions"><summary>Giao dịch của ví hiện tại ({transactions.length})</summary>
    <button className="secondary" disabled={busy} onClick={() => void run("Kiểm tra giao dịch", check)}>Kiểm tra receipt</button>
    <ul>{transactions.map(tx => <li key={tx.hash}><strong>{tx.label}</strong> · {tx.status}<div className="mono small">{tx.hash}</div></li>)}</ul>
    <p className="muted">Xác nhận blockchain và dữ liệu API có thể cập nhật lệch vài giây. Kiểm tra receipt trước khi gửi lại.</p>
  </details>;
}
