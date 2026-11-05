import { useEffect, useState } from "react";
import type { NetworkStatus } from "../../domain/types";
import { formatEthAmount, formatVnd } from "../../domain/money";
import { short } from "../../domain/rules";
import { contractAt, rpc } from "../../infrastructure/wallet/useWallet";
import { errorMessage } from "../../infrastructure/wallet/transactions";
import { getAdminAccounts, getAdminChainOrders } from "../../services/admin";

// The contract's State enum, in order.
const STATES = ["Created", "Funded", "Delivered", "Completed", "Disputed", "Resolved", "Refunded", "Accepted", "Cancelled"];
const LOCKED_STATES = new Set(["Funded", "Delivered", "Disputed"]);

type AccountRow = { email: string; address: string; custodial: boolean; ledgerWei: bigint; chainWei: bigint; verified: boolean; matches: boolean };
type OrderRow = { orderId: string; sqlState: string; chainState: string; sqlWei: bigint; chainWei: bigint; matches: boolean };
type Report = { accounts: AccountRow[]; orders: OrderRow[]; sqlLocked: bigint; chainLocked: bigint };

// SQL's figures come from the API; every chain figure is read by this browser from the node, so the API cannot vouch for itself.
async function buildReport(token: string, network: NetworkStatus, signal: AbortSignal): Promise<Report> {
  const contract = contractAt(network);
  const [accounts, orders] = await Promise.all([getAdminAccounts(token, signal), getAdminChainOrders(token, signal)]);
  const accountRows = await Promise.all(accounts.accounts.map(async account => {
    const [chainWei, verified] = await Promise.all([rpc.getBalance(account.address), contract.verifiedWallets(account.address) as Promise<boolean>]);
    const ledgerWei = BigInt(account.balanceWei);
    return { email: account.email, address: account.address, custodial: account.custodial, ledgerWei, chainWei, verified, matches: !account.custodial || chainWei >= ledgerWei };
  }));
  const orderRows = await Promise.all(orders.map(async order => {
    const onChain = await contract.getOrder(BigInt(order.orderId));
    const chainState = STATES[Number(onChain.state)] ?? String(onChain.state);
    const sqlWei = BigInt(order.amountWei), chainWei = BigInt(onChain.amountWei);
    return { orderId: order.orderId, sqlState: order.state, chainState, sqlWei, chainWei, matches: order.state === chainState && sqlWei === chainWei };
  }));
  const sqlLocked = orderRows.filter(order => LOCKED_STATES.has(order.sqlState)).reduce((total, order) => total + order.sqlWei, 0n);
  return { accounts: accountRows, orders: orderRows, sqlLocked, chainLocked: BigInt(await contract.totalLockedWei()) };
}

const Result = ({ ok }: { ok: boolean }) => ok ? <>Khớp</> : <strong className="chain-mismatch">Lệch</strong>;

export default function ChainReconciliation({ token, network, revision, latest }: { token: string; network: NetworkStatus; revision: number; latest: number | null }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const ready = !!network.contractAddress && latest !== null;
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    buildReport(token, network, controller.signal).then(next => { setReport(next); setError(""); })
      .catch(failure => { if (!controller.signal.aborted) setError(errorMessage(failure)); });
    return () => controller.abort();
  // A new block is what can change the comparison.
  }, [token, network.contractAddress, revision, latest, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const lockedMatches = report ? report.sqlLocked === report.chainLocked : true;
  const mismatches = report ? report.accounts.filter(row => !row.matches).length + report.orders.filter(row => !row.matches).length + (lockedMatches ? 0 : 1) : 0;
  return <section className="panel" aria-label="Đối chiếu SQL với chain"><h2>Đối chiếu SQL với chain</h2>
    <p className="muted">Số liệu SQL lấy từ API, số liệu chain do trình duyệt tự đọc từ node. Ngay sau một giao dịch có thể lệch vài giây trong lúc worker đồng bộ.</p>
    {error && <p className="banner" role="alert">Chưa đối chiếu được: {error}</p>}
    {report && <>
      <p role="status" data-testid="reconciliation-summary"><strong>{mismatches ? `Có ${mismatches} khoản lệch` : "Tất cả đều khớp"}</strong></p>
      <dl className="permission-grid"><div><dt>Đang khóa theo SQL</dt><dd>{formatEthAmount(report.sqlLocked)}</dd></div><div><dt>Đang khóa trên contract</dt><dd>{formatEthAmount(report.chainLocked)}</dd></div><div><dt>Kết quả</dt><dd><Result ok={lockedMatches} /></dd></div></dl>
      <h3>Tài khoản</h3>
      <div className="table-scroll"><table><thead><tr><th scope="col">Tài khoản</th><th scope="col">Ví</th><th scope="col">Số dư sổ cái</th><th scope="col">ETH trên chain</th><th scope="col">Xác minh on-chain</th><th scope="col">Kết quả</th></tr></thead>
        <tbody>{report.accounts.map(row => <tr key={row.address}><td>{row.email}</td><td className="mono small" title={row.address}>{short(row.address)}</td><td className="amount">{row.custodial ? formatVnd(row.ledgerWei) : "Không có sổ cái"}</td><td className="amount">{formatEthAmount(row.chainWei)}</td><td>{row.verified ? "Có" : "Không"}</td><td><Result ok={row.matches} /></td></tr>)}</tbody></table></div>
      <h3>Đơn hàng</h3>
      {report.orders.length ? <div className="table-scroll"><table><thead><tr><th scope="col">Đơn</th><th scope="col">Trạng thái SQL</th><th scope="col">Trạng thái chain</th><th scope="col">Số tiền chain</th><th scope="col">Kết quả</th></tr></thead>
        <tbody>{report.orders.map(row => <tr key={row.orderId}><td>#{row.orderId}</td><td>{row.sqlState}</td><td>{row.chainState}</td><td className="amount">{formatEthAmount(row.chainWei)}</td><td><Result ok={row.matches} /></td></tr>)}</tbody></table></div> : <p className="muted">Chưa có đơn nào trên contract này.</p>}
      <p className="small muted">Với ví lưu ký, ETH trên chain được phép cao hơn sổ cái vì có thêm phần dự phòng phí gas. Ví MetaMask chỉ có số dư trên chain.</p>
    </>}
  </section>;
}
