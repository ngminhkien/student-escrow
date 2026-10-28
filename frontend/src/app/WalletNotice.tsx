import type { LinkedWallet } from "../domain/types";

type Props = { linked: LinkedWallet | null; account: string; chainId: string; available: boolean; checking: boolean; ready: boolean };
export default function WalletNotice({ linked, account, chainId, available, checking, ready }: Props) {
  if (ready || linked && !linked.linked) return null;
  const title = !linked ? "Đang kiểm tra ví của tài khoản"
    : !available ? "Chưa tìm thấy MetaMask"
    : !account ? "Chưa kết nối ví MetaMask"
    : account.toLowerCase() !== linked.address?.toLowerCase() ? "MetaMask đang kết nối sai ví"
    : chainId !== "31337" ? "MetaMask đang kết nối sai mạng"
    : "Đang kiểm tra kết nối MetaMask";
  return <section id="wallet-access-warning" className="banner wallet-access-warning" role={checking || !linked ? "status" : "alert"} aria-live="polite">
    <strong>{title}</strong>
    <p>Các nút chức năng đang bị khóa cho đến khi kết nối đúng ví và mạng của tài khoản.</p>
    {linked?.address && <><p>Chọn ví liên kết: <span className="mono">{linked.address}</span></p><p>Ví MetaMask hiện tại: <span className="mono">{account || "Chưa kết nối"}</span></p><p>Mạng yêu cầu: StudentEscrow Local (31337). Mạng hiện tại: {chainId || "Chưa kết nối"}.</p></>}
    <p>{checking ? "Mở MetaMask để xác nhận yêu cầu đang chờ." : "Bấm “Đồng bộ ví”, chọn đúng ví và xác nhận trong MetaMask để tiếp tục."}</p>
  </section>;
}
