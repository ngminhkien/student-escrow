import { useEffect, useState } from "react";
import type { NetworkStatus } from "../../domain/types";
import { formatEthAmount, formatVnd } from "../../domain/money";
import { errorMessage } from "../../infrastructure/wallet/transactions";
import { formatDate } from "../../shared/format";
import { CopyButton, Copyable } from "../../shared/ui/CopyButton";
import { blockTime, gasFee, hexNumber, isTransactionHash, loadReceipt, receiptEvents, summarize, useChainHead } from "./chainData";
import type { ChainReceipt } from "./chainData";
import { receiptUrl } from "./ReceiptLink";

const Outcome = ({ item }: { item: ChainReceipt }) => !item.receipt
  ? <span className="receipt-status receipt-status-pending">Chờ vào block</span>
  : item.receipt.status === "0x1" ? <span className="receipt-status receipt-status-ok">Thành công</span>
  : <span className="receipt-status receipt-status-failed">Thất bại</span>;

export { Outcome };

// Everything here is read from the node, so anyone holding the link sees the same bill without an account.
export default function ReceiptView({ hash, network, onBack, standalone = false }: { hash: string; network: NetworkStatus; onBack?: () => void; standalone?: boolean }) {
  const [item, setItem] = useState<ChainReceipt | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState("");
  const { head } = useChainHead();
  const settled = !!item?.receipt;
  const valid = isTransactionHash(hash);
  useEffect(() => {
    if (!valid) return;
    let active = true;
    loadReceipt(hash).then(value => { if (active) { setItem(value); setMissing(!value); setError(""); } })
      .catch(failure => { if (active) setError(errorMessage(failure)); });
    return () => { active = false; };
  // A settled transaction never changes; until then each new block may be the one that holds it.
  }, [hash, valid, network.deploymentId, settled ? "settled" : head]); // eslint-disable-line react-hooks/exhaustive-deps

  const Title = standalone ? "h1" : "h2";
  const back = onBack && <button type="button" className="text-button receipt-back" onClick={onBack}><span aria-hidden="true">←</span> Danh sách biên lai</button>;
  if (!valid || missing) return <div className="receipt-page">{back}<section className="panel receipt-missing" aria-label="Biên lai"><Title>Không tìm thấy biên lai</Title>
    <p className="muted">{valid ? "Chain này không có giao dịch với mã đó. Khi chain local được chạy lại từ đầu, biên lai của lần chạy trước không còn." : "Mã giao dịch phải gồm 0x và 64 ký tự."}</p><p className="mono small">{hash}</p></section></div>;
  if (!item) return <div className="receipt-page">{back}<section className="panel" aria-label="Biên lai">{error ? <p className="banner" role="alert">Không đọc được node: {error}</p> : <p role="status">Đang đọc biên lai từ node…</p>}</section></div>;

  const contract = network.contractAddress;
  const summary = summarize(item, contract);
  const events = receiptEvents(item.receipt, contract);
  const fee = gasFee(item.receipt);
  const blockNumber = item.block ? hexNumber(item.block.number) : null;
  const to = item.tx.to ?? item.receipt?.contractAddress ?? null;
  return <div className="receipt-page">{back}
    <div className="receipt-layout">
      <article className="receipt" aria-label="Biên lai giao dịch">
        <header className="receipt-header"><div><strong>StudentEscrow</strong><span>Biên lai giao dịch</span></div><Outcome item={item} /></header>
        <Title className="receipt-title">{summary.title}</Title>
        {summary.amountWei !== undefined
          ? <div className="receipt-amount"><span>{summary.amountLabel}</span><strong data-testid="receipt-amount">{formatVnd(summary.amountWei)}</strong><small>{formatEthAmount(summary.amountWei)}</small></div>
          : <p className="receipt-no-amount">Giao dịch này không chuyển tiền.</p>}
        <div className="receipt-txid"><span>Mã giao dịch (Txid)</span><Copyable value={item.tx.hash} label="mã giao dịch" /></div>
        <dl className="receipt-lines">
          {summary.lines.map(line => <div key={line.label}><dt>{line.label}</dt><dd className="num">{formatVnd(line.wei)}</dd></div>)}
          <div><dt>Thời gian</dt><dd>{item.block ? formatDate(blockTime(item.block)) : "—"}</dd></div>
          <div><dt>Ví gửi</dt><dd><Copyable value={item.tx.from} label="ví gửi" /></dd></div>
          <div><dt>{item.tx.to ? "Ví hoặc contract nhận" : "Contract được tạo"}</dt><dd>{to ? <Copyable value={to} label="địa chỉ nhận" /> : "—"}</dd></div>
          <div><dt>Phí gas</dt><dd className="num">{fee === null ? "—" : formatEthAmount(fee)}</dd></div>
        </dl>
        <footer className="receipt-actions"><CopyButton value={receiptUrl(item.tx.hash)} label="link biên lai" text="Sao chép link biên lai" /></footer>
      </article>
      <aside className="panel receipt-proof" aria-label="Bằng chứng trên chain"><h3>Bằng chứng trên chain</h3>
        <dl className="receipt-lines">
          <div><dt>Block</dt><dd className="num" data-testid="receipt-block">{blockNumber === null ? "—" : `#${blockNumber}`}</dd></div>
          <div><dt>Số block xác nhận</dt><dd className="num" data-testid="receipt-confirmations">{blockNumber === null || head === null ? "—" : Math.max(0, head - blockNumber + 1)}</dd></div>
          <div className="receipt-line-stack"><dt>Hash của block</dt><dd>{item.block ? <Copyable value={item.block.hash} label="hash của block" /> : "—"}</dd></div>
          <div className="receipt-line-stack"><dt>Hash của block trước</dt><dd>{item.block ? <Copyable value={item.block.parentHash} label="hash của block trước" /> : "—"}</dd></div>
        </dl>
        <p className="small muted">Mỗi block chứa hash của block trước. Sửa giao dịch này sẽ đổi hash của block và làm đứt mọi liên kết phía sau.</p>
        <details className="receipt-events"><summary>Sự kiện của contract ({events.length})</summary>
          {events.length ? <ul className="chain-events">{events.map((event, index) => <li key={index}><strong>{event.name}</strong><div className="mono small">{event.detail}</div></li>)}</ul> : <p className="muted">Giao dịch này không phát sự kiện của contract.</p>}
        </details>
        <p className="small muted">Đọc trực tiếp từ node, không qua máy chủ của ứng dụng.</p>
      </aside>
    </div>
  </div>;
}
