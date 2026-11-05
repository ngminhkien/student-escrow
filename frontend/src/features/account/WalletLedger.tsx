import type { WalletAccount } from "../../domain/types";
import { formatVnd } from "../../domain/money";
import { formatDate } from "../../shared/format";
import { TxHash } from "../chain/ReceiptLink";

const labels: Record<string, string> = {
  AdminCredit: "Nạp tiền", GatewayDeposit: "Nạp tiền qua cổng", EscrowHold: "Ký quỹ đơn", EscrowHoldRelease: "Hoàn ký quỹ chưa thực hiện",
  EscrowPayout: "Nhận thanh toán", EscrowRefund: "Được hoàn tiền", ChainReversal: "Điều chỉnh do blockchain đổi"
};
export default function WalletLedger({ account }: { account: WalletAccount }) {
  return <section className="panel wallet-ledger" aria-label="Lịch sử số dư"><h2>Lịch sử số dư</h2>
    {!account.entries.length ? <p className="muted">Chưa có biến động. Nạp tiền ở mục phía trên để bắt đầu.</p>
      : <div className="order-list"><table className="ledger-table"><thead><tr><th>Thời gian</th><th>Loại</th><th>Số tiền</th><th>Số dư sau</th><th>Giao dịch</th></tr></thead><tbody>{account.entries.map(entry => <tr key={entry.id}>
        <td data-label="Thời gian">{formatDate(entry.createdAt)}</td><td data-label="Loại">{labels[entry.type] ?? entry.type}{entry.orderId && <span className="small muted"> · đơn #{entry.orderId}</span>}</td>
        <td data-label="Số tiền" className={BigInt(entry.amountWei) < 0n ? "amount ledger-out" : "amount ledger-in"}>{BigInt(entry.amountWei) > 0n && "+"}{formatVnd(entry.amountWei)}</td>
        <td data-label="Số dư sau" className="amount">{formatVnd(entry.balanceAfterWei)}</td>
        <td data-label="Giao dịch" className="small">{entry.transactionHash ? <TxHash hash={entry.transactionHash} compact /> : "—"}</td>
      </tr>)}</tbody></table></div>}
  </section>;
}
