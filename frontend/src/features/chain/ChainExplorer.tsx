import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { isAddress } from "ethers";
import type { NetworkStatus } from "../../domain/types";
import { formatEthAmount, formatVnd } from "../../domain/money";
import { contractAt, rpc } from "../../infrastructure/wallet/useWallet";
import { errorMessage } from "../../infrastructure/wallet/transactions";
import { formatDate } from "../../shared/format";
import { Copyable, shorten } from "../../shared/ui/CopyButton";
import { Icon } from "../../shared/ui/Icon";
import ChainReconciliation from "./ChainReconciliation";
import { blockTime, hexNumber, isTransactionHash, loadBlockPage, loadReceiptPage, summarize, useChainHead } from "./chainData";
import type { ChainReceipt, RawBlock, RawTransaction } from "./chainData";
import { openReceipt, ReceiptLink, TxHash } from "./ReceiptLink";
import ReceiptView, { Outcome } from "./ReceiptView";

const PAGE_SIZE = 10;
type View = "receipts" | "blocks" | "reconcile";
type WalletLookup = { address: string; balance: bigint; verified: boolean | null; arbiter: boolean | null };

function Pager({ page, total, onPrevious, onNext, hasNext }: { page: number; total?: number; onPrevious: () => void; onNext: () => void; hasNext: boolean }) {
  return <nav className="chain-pager" aria-label="Phân trang">
    <button type="button" className="secondary" disabled={page === 0} onClick={onPrevious}>Trang trước</button>
    <span data-testid="chain-page">Trang {page + 1}{total ? ` / ${total}` : ""}</span>
    <button type="button" className="secondary" disabled={!hasNext} onClick={onNext}>Trang sau</button>
  </nav>;
}

function ReceiptList({ head, contract }: { head: number | null; contract?: string }) {
  // Page one follows the chain; older pages start from a fixed block, so a new transaction does not shift what is being read.
  const [starts, setStarts] = useState<number[]>([]);
  const [data, setData] = useState<{ rows: ChainReceipt[]; next: number | null } | null>(null);
  const [error, setError] = useState("");
  const start = starts.at(-1) ?? head;
  useEffect(() => {
    if (start === null) return;
    let active = true;
    loadReceiptPage(start, PAGE_SIZE).then(value => { if (active) { setData(value); setError(""); } })
      .catch(failure => { if (active) setError(errorMessage(failure)); });
    return () => { active = false; };
  }, [start]);
  return <section className="panel" aria-label="Biên lai giao dịch"><h2>Biên lai giao dịch</h2>
    {error && <p className="banner" role="alert">Chưa đọc được danh sách: {error}</p>}
    {!data && !error && <p role="status">Đang đọc từ node…</p>}
    {data && !data.rows.length && <p className="chain-empty">Chain này chưa có giao dịch.</p>}
    {!!data?.rows.length && <div className="table-scroll"><table className="chain-table"><thead><tr><th scope="col">Giao dịch</th><th scope="col">Mã giao dịch</th><th scope="col">Thời gian</th><th scope="col" className="num">Số tiền</th><th scope="col">Kết quả</th></tr></thead>
      <tbody>{data.rows.map(item => { const summary = summarize(item, contract); return <tr key={item.tx.hash}>
        <td data-label="Giao dịch"><ReceiptLink hash={item.tx.hash}><strong>{summary.title}</strong></ReceiptLink><div className="small muted">Block #{item.tx.blockNumber ? hexNumber(item.tx.blockNumber) : "—"}</div></td>
        <td data-label="Mã giao dịch"><TxHash hash={item.tx.hash} compact /></td>
        <td data-label="Thời gian">{item.block ? formatDate(blockTime(item.block)) : "—"}</td>
        <td data-label="Số tiền" className="num">{summary.amountWei === undefined ? <span className="muted">—</span> : formatVnd(summary.amountWei)}</td>
        <td data-label="Kết quả"><Outcome item={item} /></td>
      </tr>; })}</tbody></table></div>}
    {!!data && (starts.length > 0 || data.next !== null) && <Pager page={starts.length} hasNext={data.next !== null} onPrevious={() => setStarts(value => value.slice(0, -1))} onNext={() => { if (data.next !== null) setStarts(value => [...value, data.next as number]); }} />}
  </section>;
}

function BlockList({ head }: { head: number | null }) {
  const [page, setPage] = useState(0);
  const [blocks, setBlocks] = useState<RawBlock<RawTransaction>[] | null>(null);
  const [error, setError] = useState("");
  const total = head === null ? 0 : Math.ceil((head + 1) / PAGE_SIZE);
  useEffect(() => {
    if (head === null) return;
    let active = true;
    loadBlockPage(head, page, PAGE_SIZE).then(value => { if (active) { setBlocks(value); setError(""); } })
      .catch(failure => { if (active) setError(errorMessage(failure)); });
    return () => { active = false; };
  }, [head, page]);
  return <section className="panel" aria-label="Các block"><h2>Các block</h2>
    <p className="muted">Mỗi block chứa hash của block trước. Sửa một giao dịch cũ sẽ đổi hash block đó và làm đứt mọi liên kết phía sau.</p>
    {error && <p className="banner" role="alert">Chưa đọc được các block: {error}</p>}
    {!!blocks?.length && <div className="table-scroll"><table className="chain-table"><thead><tr><th scope="col">Block</th><th scope="col">Thời gian</th><th scope="col">Hash</th><th scope="col">Hash block trước</th><th scope="col">Biên lai</th></tr></thead>
      <tbody>{blocks.map(block => <tr key={block.hash}>
        <td data-label="Block"><strong>#{hexNumber(block.number)}</strong></td><td data-label="Thời gian">{formatDate(blockTime(block))}</td>
        <td data-label="Hash"><Copyable value={block.hash} label={`hash block ${hexNumber(block.number)}`} display={shorten(block.hash)} /></td>
        <td data-label="Hash block trước"><Copyable value={block.parentHash} label={`hash trước block ${hexNumber(block.number)}`} display={shorten(block.parentHash)} /></td>
        <td data-label="Biên lai">{block.transactions.length ? <span className="chain-block-receipts">{block.transactions.map(tx => <ReceiptLink key={tx.hash} hash={tx.hash} label={`Xem biên lai ${tx.hash}`}><span className="mono">{shorten(tx.hash)}</span></ReceiptLink>)}</span> : <span className="muted">Không có giao dịch</span>}</td>
      </tr>)}</tbody></table></div>}
    {total > 1 && <Pager page={Math.min(page, total - 1)} total={total} hasNext={page + 1 < total} onPrevious={() => setPage(value => Math.max(0, value - 1))} onNext={() => setPage(value => value + 1)} />}
  </section>;
}

export default function ChainExplorer({ network, revision, token, admin, receipt, onCloseReceipt }: { network: NetworkStatus; revision: number; token: string; admin: boolean; receipt: string | null; onCloseReceipt: () => void }) {
  const { head, error } = useChainHead();
  const [view, setView] = useState<View>("receipts");
  const [query, setQuery] = useState("");
  const [searchError, setSearchError] = useState("");
  const [wallet, setWallet] = useState<WalletLookup | null>(null);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    setSearchError(""); setWallet(null);
    try {
      if (isTransactionHash(value)) { setQuery(""); openReceipt(value); }
      else if (isAddress(value)) {
        const balance = await rpc.getBalance(value);
        let verified: boolean | null = null, arbiter: boolean | null = null;
        if (network.contractAddress) {
          const contract = contractAt(network);
          [verified, arbiter] = await Promise.all([contract.verifiedWallets(value), contract.approvedArbiters(value)]);
        }
        setWallet({ address: value, balance, verified, arbiter });
      } else setSearchError("Nhập mã giao dịch (0x + 64 ký tự) hoặc địa chỉ ví (0x + 40 ký tự).");
    } catch (failure) { setSearchError(errorMessage(failure)); }
  }

  const yesNo = (value: boolean | null) => value === null ? "Chưa có contract" : value ? "Có" : "Không";
  const views: [View, string][] = [["receipts", "Biên lai"], ["blocks", "Các block"], ...(admin ? [["reconcile", "Đối chiếu"] as [View, string]] : [])];
  return <div className="chain-explorer">
    <section className="panel chain-lookup" aria-label="Tra cứu">
      <form className="chain-search" onSubmit={event => void search(event)}>
        <label htmlFor="chain-query">Tra mã giao dịch hoặc địa chỉ ví</label>
        <div className="chain-search-row">
          <input id="chain-query" name="chainQuery" autoComplete="off" spellCheck={false} value={query} onChange={event => setQuery(event.target.value)} placeholder="0x…" />
          <button disabled={!query.trim()}><Icon name="search" size={16} />Tra cứu</button>
        </div>
      </form>
      <p className="chain-live" role="status"><span className={`connection-dot ${error ? "" : "online"}`} aria-hidden="true" />{error ? "Không đọc được node" : <>Đang cập nhật trực tiếp · Block mới nhất <strong className="num" data-testid="chain-head">{head ?? "—"}</strong></>}</p>
      {error && <p className="banner" role="alert">Không đọc được node: {error}</p>}
      {searchError && <p className="banner" role="alert">{searchError}</p>}
      {wallet && <dl className="receipt-lines chain-wallet" aria-label="Thông tin ví">
        <div><dt>Địa chỉ</dt><dd><Copyable value={wallet.address} label="địa chỉ ví" /></dd></div>
        <div><dt>Số dư trên chain</dt><dd className="num">{formatEthAmount(wallet.balance)}</dd></div>
        <div><dt>Đã xác minh trên contract</dt><dd>{yesNo(wallet.verified)}</dd></div>
        <div><dt>Trong danh sách Arbiter</dt><dd>{yesNo(wallet.arbiter)}</dd></div>
      </dl>}
    </section>

    {receipt ? <ReceiptView hash={receipt} network={network} onBack={onCloseReceipt} /> : <>
      <div className="order-workspace-tabs" role="group" aria-label="Nội dung chain">{views.map(([id, label]) => <button key={id} type="button" className={view === id ? "" : "secondary"} aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}</div>
      {view === "receipts" && <ReceiptList head={head} contract={network.contractAddress} />}
      {view === "blocks" && <BlockList head={head} />}
      {view === "reconcile" && <ChainReconciliation token={token} network={network} revision={revision} latest={head} />}
    </>}
  </div>;
}
