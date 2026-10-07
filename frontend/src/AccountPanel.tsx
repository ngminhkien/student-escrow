import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "./api";
import { assertWallet, contractAt, errorMessage } from "./wallet";
import { sameAddress } from "./rules";
import type { Kyc, LinkedWallet, NetworkStatus, RunAction, Session } from "./types";

export default function AccountPanel({ session, account, canSign, network, busy, run, onLinked, revision }: {
  session: Session; account: string; canSign: boolean; network: NetworkStatus; busy: boolean; run: RunAction;
  onLinked: (wallet: LinkedWallet) => void; revision: number;
}) {
  const [wallet, setWallet] = useState<LinkedWallet | null>(null);
  const [kyc, setKyc] = useState<Kyc | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let stop = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const [linked, status] = await Promise.all([api<LinkedWallet>("/wallets/me", session.accessToken, "GET", undefined, controller.signal),
          api<Kyc>("/kyc/me", session.accessToken, "GET", undefined, controller.signal)]);
        if (stop) return;
        setWallet(linked); onLinked(linked); setKyc(status); setError("");
        if (linked.address && network.status === "Ready") {
          const value = await contractAt(network).verifiedWallets(linked.address) as boolean;
          if (!stop) setVerified(value);
        } else setVerified(null);
      } catch (failure) { if (!stop) { setError(errorMessage(failure)); setVerified(null); } }
      if (!stop) timer = setTimeout(() => void refresh(), 15000);
    }
    void refresh();
    return () => { stop = true; controller.abort(); clearTimeout(timer); };
  }, [session.accessToken, network.deploymentId, network.status, revision, onLinked]);
  async function link() {
    const expected = account;
    const provider = await assertWallet(expected);
    const challenge = await api<{ challengeId: string; address: string; message: string; expiresAt: string }>("/wallets/challenges", session.accessToken, "POST", { address: expected, chainId: 31337 });
    if (!sameAddress(challenge.address, expected) || new Date(challenge.expiresAt).getTime() <= Date.now()) throw new Error("Challenge không hợp lệ hoặc đã hết hạn.");
    const signer = await provider.getSigner(expected);
    const signature = await signer.signMessage(challenge.message);
    await assertWallet(expected);
    const linked = await api<LinkedWallet>("/wallets/link", session.accessToken, "POST", { challengeId: challenge.challengeId, signature });
    setWallet(linked); onLinked(linked);
  }
  function submitKyc(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run("Nộp KYC demo", async () => setKyc(await api<Kyc>("/kyc/submissions", session.accessToken, "POST", {
      fullName: data.get("fullName"), studentNumber: data.get("studentNumber"), documentReference: data.get("documentReference"), selfieReference: data.get("selfieReference") })));
  }
  return <div className="grid">
    <section className="panel"><h2>Tài khoản & liên kết ví</h2><p>{session.user.fullName} · {session.user.email}</p>
      {error && <p role="alert">{error}</p>}
      <dl><dt>Ví liên kết</dt><dd className="mono">{wallet?.address ?? "Chưa liên kết"}</dd><dt>Mạng của ví liên kết</dt><dd>{wallet?.chainId ?? "—"}</dd></dl>
      {!wallet?.linked && <><p>Ký thông điệp một lần để chứng minh bạn sở hữu ví đang chọn; thao tác này không chuyển ETH.</p>
        <button disabled={busy || !canSign || !wallet} onClick={() => void run("Liên kết ví", link)}>Ký và liên kết ví</button></>}
      {wallet?.linked && <p>Ví đã liên kết cố định. Muốn dùng vai trò khác, đăng nhập tài khoản có ví tương ứng.</p>}
      <hr /><h3>Xác minh on-chain</h3><p>{verified === null ? "Chưa đọc được trạng thái contract." : verified ? "Đã được Admin xác minh trên contract hiện tại." : "Chưa được Admin xác minh trên contract hiện tại."}</p>
      <p className="muted">Buyer và Seller cần xác minh on-chain để tạo/nạp đơn. KYC mock bên cạnh không tự cấp quyền này. Sau khi deploy lại, Admin cần xác minh lại.</p>
    </section>
    <section className="panel"><h2>KYC demo</h2><p>Trạng thái: <strong>{kyc?.status ?? "Đang tải"}</strong>{kyc?.reasonCode && ` · ${kyc.reasonCode}`}</p>
      <p>Chỉ dùng dữ liệu giả. Chọn PASS/FAIL để thử quy trình; không tải giấy tờ thật.</p>
      <form onSubmit={submitKyc}>
        <label>Họ tên demo<input name="fullName" required minLength={2} maxLength={100} defaultValue={session.user.fullName} /></label>
        <label>Mã sinh viên demo<input name="studentNumber" required pattern="DEMO-[A-Z0-9-]{3,24}" defaultValue="DEMO-123456" /></label>
        <label>Giấy tờ mẫu<select name="documentReference"><option value="DEMO-DOCUMENT-PASS">PASS</option><option value="DEMO-DOCUMENT-FAIL">FAIL</option></select></label>
        <label>Ảnh mẫu<select name="selfieReference"><option value="DEMO-SELFIE-PASS">PASS</option><option value="DEMO-SELFIE-FAIL">FAIL</option></select></label>
        <button disabled={busy || !wallet?.linked || kyc?.status === "VERIFIED"}>Nộp KYC demo</button>
      </form>
      {kyc?.status === "VERIFIED" && <p>Hồ sơ VERIFIED không nhận nộp lại. Hồ sơ REJECTED có thể sửa mẫu và nộp lại.</p>}
    </section>
  </div>;
}
