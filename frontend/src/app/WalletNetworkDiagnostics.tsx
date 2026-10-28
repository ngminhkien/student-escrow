import { useRef, useState } from "react";
import { injected, rpc } from "../infrastructure/wallet/useWallet";
import { inspectWalletNetwork } from "../infrastructure/wallet/networkIdentity";
import type { WalletNetworkIdentity } from "../infrastructure/wallet/networkIdentity";
import type { NetworkStatus } from "../domain/types";
import { Icon } from "../shared/ui/Icon";

export default function WalletNetworkDiagnostics({ network, account, busy }: { network: NetworkStatus; account: string; busy: boolean }) {
  const scope = `${account}|${network.deploymentId}|${network.deploymentBlockHash}`;
  const currentScope = useRef(scope); currentScope.current = scope;
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ scope: string; value: WalletNetworkIdentity } | null>(null);
  async function inspect() {
    const selected = injected();
    if (!selected || checking) return;
    const check = () => { if (currentScope.current !== scope || injected() !== selected) throw new Error("Ví hoặc deployment đã thay đổi. Kiểm tra lại."); };
    setChecking(true);
    try {
      const value = await inspectWalletNetwork(selected, network, check,
        hash => rpc.send("eth_getCode", [network.contractAddress, { blockHash: hash, requireCanonical: true }]) as Promise<string>);
      check(); setResult({ scope, value });
    } catch { if (currentScope.current === scope) setResult(null); }
    finally { setChecking(false); }
  }
  const visible = result?.scope === scope ? result.value : null;
  return <div className="wallet-network-diagnostics"><button className="text-button" disabled={busy || checking || !account || network.status !== "Ready"} onClick={() => void inspect()}><Icon name="activity" size={15} />{checking ? "Đang kiểm tra blockchain…" : "Kiểm tra blockchain MetaMask"}</button>
    {visible && <section className="banner" role={visible.status === "mismatch" || visible.status === "unavailable" ? "alert" : "status"} aria-label="Kết quả kiểm tra blockchain"><strong>{visible.message}</strong>
      <dl><dt>Chain ID từ MetaMask</dt><dd>{visible.chainId ?? "Chưa đọc được"}</dd><dt>Block deployment</dt><dd>{visible.blockNumber ?? "Chưa có"}</dd><dt>Hash API yêu cầu</dt><dd className="mono">{visible.expectedHash || "Chưa có"}</dd><dt>Hash MetaMask trả theo số block</dt><dd className="mono">{visible.walletHash ?? "Không có"}</dd></dl>
      <p>Website: <span className="mono">{window.location.origin}</span>. RPC local cần dùng: <span className="mono">http://127.0.0.1:8545</span>. Dòng website trong MetaMask không phải cấu hình RPC.</p>
    </section>}
  </div>;
}
