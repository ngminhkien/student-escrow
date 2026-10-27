import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { getLinkedWallet, getKyc, createWalletChallenge, linkWallet, submitKyc as postKyc } from "../../services/account";
import { StatusBadge } from "../../shared/ui/StatusBadge";
import { assertWallet, contractAt, errorMessage, injected } from "../../wallet";
import { sameAddress } from "../../rules";
import type { Kyc, LinkedWallet, NetworkStatus, RunAction, Session } from "../../types";

export interface AccountPageProps {
  session: Session; account: string; canSign: boolean; network: NetworkStatus; busy: boolean; run: RunAction;
  onLinked: (wallet: LinkedWallet) => void; revision: number;
  chooseWallet?: () => Promise<void>;
}
export default function AccountPage({ session, account, canSign, network, busy, run, onLinked, revision, chooseWallet }: AccountPageProps) {
  const [wallet, setWallet] = useState<LinkedWallet | null>(null);
  const [kyc, setKyc] = useState<Kyc | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const currentIdentity = useRef({ token: session.accessToken, account });
  currentIdentity.current = { token: session.accessToken, account };
  const linkLifecycle = useRef({ generation: 0, mounted: false });
  const linkRequests = useRef(new Set<AbortController>());
  useEffect(() => {
    linkLifecycle.current.mounted = true;
    linkLifecycle.current.generation++;
    return () => {
      linkLifecycle.current.mounted = false;
      linkLifecycle.current.generation++;
      linkRequests.current.forEach(controller => controller.abort());
      linkRequests.current.clear();
    };
  }, [session.accessToken]);
  useEffect(() => { setWallet(null); setKyc(null); setVerified(null); setError(""); }, [session.accessToken]);
  useEffect(() => { setVerified(null); }, [network.deploymentId, network.status]);
  useEffect(() => {
    let stop = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const [linked, status] = await Promise.all([getLinkedWallet(session.accessToken, controller.signal),
          getKyc(session.accessToken, controller.signal)]);
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
    const token = session.accessToken;
    const generation = linkLifecycle.current.generation;
    const selectedProvider = injected();
    const controller = new AbortController();
    function assertCurrent() {
      if (!linkLifecycle.current.mounted || linkLifecycle.current.generation !== generation ||
        currentIdentity.current.token !== token || !sameAddress(currentIdentity.current.account, expected))
        throw new Error("Phiên hoặc tài khoản đã thay đổi. Vui lòng bắt đầu liên kết lại.");
      if (!selectedProvider || selectedProvider !== injected())
        throw new Error("Ví đang hoạt động đã thay đổi. Vui lòng bắt đầu liên kết lại.");
    }
    linkRequests.current.add(controller);
    try {
      assertCurrent();
      const provider = await assertWallet(expected, selectedProvider);
      assertCurrent();
      const challenge = await createWalletChallenge(token, { address: expected, chainId: 31337 }, controller.signal);
      assertCurrent();
      const expiresAt = new Date(challenge.expiresAt).getTime();
      if (challenge.chainId !== 31337 || !sameAddress(challenge.address, expected) || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error("Challenge không hợp lệ hoặc đã hết hạn.");
      await assertWallet(expected, selectedProvider);
      assertCurrent();
      const signer = await provider.getSigner(expected);
      assertCurrent();
      await assertWallet(expected, selectedProvider);
      assertCurrent();
      const signature = await signer.signMessage(challenge.message);
      assertCurrent();
      await assertWallet(expected, selectedProvider);
      assertCurrent();
      if (expiresAt <= Date.now()) throw new Error("Challenge đã hết hạn. Vui lòng bắt đầu liên kết lại.");
      const linked = await linkWallet(token, { challengeId: challenge.challengeId, signature }, controller.signal);
      assertCurrent();
      setWallet(linked); onLinked(linked);
    } finally {
      linkRequests.current.delete(controller);
    }
  }
  function submitKyc(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run("Nộp KYC demo", async () => setKyc(await postKyc(session.accessToken, {
      fullName: String(data.get("fullName") ?? ""), studentNumber: String(data.get("studentNumber") ?? ""), documentReference: String(data.get("documentReference") ?? ""), selfieReference: String(data.get("selfieReference") ?? "") })));
  }
  return <div className="account-page"><div className="workflow-strip"><span>01 · Đăng nhập</span><span>02 · Liên kết ví</span><span>03 · Xác minh on-chain</span></div><section className="panel profile-card"><div className="profile-initial" aria-hidden="true">{session.user.fullName.slice(0, 1).toUpperCase()}</div><div><p className="page-eyebrow">TÀI KHOẢN CỦA BẠN</p><h2>{session.user.fullName}</h2><p className="muted">{session.user.email}</p></div></section><div className="grid account-grid">
    <section className="panel"><h2>Liên kết ví</h2><p className="muted">Một tài khoản, một địa chỉ ví cố định.</p>
      {error && <p role="alert">{error}</p>}
      <dl><dt>Ví liên kết</dt><dd className="mono">{wallet?.address ?? "Chưa liên kết"}</dd><dt>Mạng của ví liên kết</dt><dd>{wallet?.chainId ?? "—"}</dd></dl>
      <dl><dt>Ví đang chọn trong MetaMask</dt><dd className="mono">{account || "Chưa kết nối"}</dd></dl>
      {!wallet?.linked && <><p>Chọn ví bạn muốn dùng và ký xác nhận một lần. Chữ ký liên kết không chuyển ETH và không tốn gas.</p>
        {chooseWallet && <button className="secondary" disabled={busy} onClick={() => void run("Chọn ví MetaMask", chooseWallet)}>Đổi ví MetaMask</button>}{" "}
        <button disabled={busy || !canSign || !wallet} onClick={() => void run("Liên kết ví", link)}>Ký và liên kết ví</button></>}
      {wallet?.linked && <p>Ví đã liên kết cố định. Khi đăng nhập, ứng dụng tự kiểm tra và yêu cầu chọn đúng ví này. Bạn có thể bấm “Đồng bộ ví” để kiểm tra lại bất cứ lúc nào.</p>}
      <hr /><h3>Xác minh on-chain</h3><p>{verified === null ? "Chưa đọc được trạng thái contract." : verified ? "Đã được Admin xác minh trên contract hiện tại." : "Chưa được Admin xác minh trên contract hiện tại."}</p>
      <p className="muted">Buyer và Seller cần xác minh on-chain để tạo/nạp đơn. KYC mock bên cạnh không tự cấp quyền này. Sau khi deploy lại, Admin cần xác minh lại.</p>
    </section>
    <section className="panel"><h2>Xác minh thử nghiệm</h2><p>Trạng thái: <StatusBadge status={kyc?.status ?? "Đang tải"} />{kyc?.reasonCode && ` · ${kyc.reasonCode}`}</p>
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
  </div></div>;
}
