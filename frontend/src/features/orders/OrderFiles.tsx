import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { sha256 } from "ethers";
import { getOrder, uploadOrderFile, downloadOrderFile } from "../../services/orders";
import { health } from "../../services/health";
import { actions, validateTerms } from "../../domain/rules";
import { pendingTimestamp, assertWallet } from "../../wallet";
import type { OrderFile, OrderView } from "../../domain/types";
import type { OrdersProps } from "./types";
import { Icon } from "../../shared/ui/Icon";
export default function OrderFiles({ session, account, canSign, network, chainTime, busy, run, view, onHashMismatch, onRefresh }: OrdersProps & { view: OrderView; onHashMismatch: () => void; onRefresh: () => void }) {
  const [fileCheck, setFileCheck] = useState("");
  const allowed = actions(view, account, network, chainTime);
  const draft = view.draft;
  const product = view.files.find(file => file.kind === "product");
  const scope = `${session.accessToken}|${account}|${network.deploymentId}|${draft.id}|${canSign}`;
  const liveScope = useRef(scope); liveScope.current = scope;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function assertCurrent() { if (!mounted.current || liveScope.current !== scope) throw new Error("Tài khoản, ví hoặc đơn đã thay đổi. Hãy thao tác lại."); }
  function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file") as File;
    const kind = data.get("kind") as "product" | "evidence";
    void run("Upload file", async () => {
      if (!allowed[kind]) throw new Error("Không có quyền upload loại file này ở trạng thái hiện tại.");
      if (!canSign) throw new Error("Chọn đúng ví liên kết trước khi tải lên.");
      await assertWallet(account);
      const freshNetwork = await health();
      const fresh = await getOrder(session.accessToken, draft.id);
      validateTerms(fresh, freshNetwork);
      if (!actions(fresh, account, freshNetwork, await pendingTimestamp())[kind]) throw new Error("Quyền tải lên đã thay đổi. Hãy tải lại đơn.");
      if (fresh.files.reduce((sum, item) => sum + item.length, 0) + file.size > 75_000_000) throw new Error("Tổng dung lượng đơn không vượt quá 75 MB.");
      const limit = kind === "product" ? 50_000_000 : 5_000_000;
      const extension = file.name.split(".").pop()?.toLowerCase();
      if (!file.size || file.size > limit) throw new Error(`File phải có nội dung, không quá ${limit / 1000000} MB.`);
      if (!(kind === "product" ? extension === "zip" : ["png", "jpg", "jpeg", "pdf"].includes(extension ?? ""))) throw new Error("Định dạng file không được hỗ trợ.");
      const localHash = sha256(new Uint8Array(await file.arrayBuffer()));
      assertCurrent();
      const saved = await uploadOrderFile(session.accessToken, draft.id, data);
      if (kind === "product" && saved.sha256.toLowerCase() !== localHash.toLowerCase()) sessionStorage.setItem("escrow.hash-mismatch." + session.user.id + "." + draft.id, "1");
      assertCurrent();
      if (saved.sha256.toLowerCase() !== localHash.toLowerCase()) { if (kind === "product") onHashMismatch(); onRefresh(); throw new Error("Hash file server trả về khác byte vừa upload. Không sử dụng file này."); }
      onRefresh();
      form.reset();
    });
  }
  async function download(file: OrderFile) {
    const bytes = await downloadOrderFile(session.accessToken, draft.id, file.id);
    assertCurrent();
    if (bytes.length !== file.length || sha256(bytes).toLowerCase() !== file.sha256.toLowerCase()) throw new Error("Dung lượng hoặc hash file tải xuống không khớp. Không dùng file này để nghiệm thu.");
    const link = document.createElement("a"); const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    link.href = url; link.download = file.fileName; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  return <section className="order-files" aria-label="File sản phẩm và bằng chứng">
    <div className="file-section-title"><span className="surface-icon"><Icon name="code" size={22} /></span><h3>Sản phẩm bàn giao</h3></div>
    {allowed.product && <form className="upload-form product-upload" onSubmit={upload} aria-label="Tải ZIP mã nguồn">
      <input type="hidden" name="kind" value="product" />
      <span className="upload-mark" aria-hidden="true"><Icon name="upload" size={26} /></span>
      <label>Chọn ZIP mã nguồn<input type="file" name="file" required accept=".zip" /></label>
      <button disabled={busy || !canSign}>Tải ZIP mã nguồn</button>
    </form>}
    {allowed.product && <p className="muted">ZIP tối đa 50 MB · Xác nhận bàn giao sau khi tải lên.</p>}
    {allowed.evidence && <details><summary>Bổ sung bằng chứng</summary><form className="upload-form" onSubmit={upload}>
      <input type="hidden" name="kind" value="evidence" />
      <label>Chọn bằng chứng<input type="file" name="file" required accept=".png,.jpg,.jpeg,.pdf" /></label>
      <button disabled={busy || !canSign}>Tải bằng chứng</button>
    </form></details>}
    {(["product", "evidence"] as const).filter(kind => kind === "product" || view.files.some(file => file.kind === kind)).map(kind => <section key={kind} aria-label={kind === "product" ? "Sản phẩm bàn giao" : "Bằng chứng"}>{kind === "evidence" && <h4>Bằng chứng</h4>}{!view.files.some(file => file.kind === kind) ? <p>Chưa có ZIP sản phẩm.</p> : <ul className="files">{view.files.filter(file => file.kind === kind).map(file => <li key={file.id}>
      <div><strong>{file.fileName}</strong> · {file.kind === "product" ? "Sản phẩm" : "Bằng chứng"} · {file.length.toLocaleString("vi-VN")} byte
        <details><summary>Hash file</summary><div className="mono small">SHA-256: {file.sha256}</div></details></div><button className="secondary" disabled={busy} onClick={() => void run("Tải và kiểm tra hash", () => download(file))}>Tải {file.fileName}</button>
    </li>)}</ul>}</section>)}
    {view.chain?.deliveryHash && <p data-testid="delivery-match">{view.deliveryFileMatchesChain ? "✓ File khớp bản bàn giao trên chain." : "Không khớp ZIP trên hệ thống."}</p>}
    <details><summary>Kiểm tra hash file có trên máy</summary><label>File cần kiểm tra<input type="file" onChange={event => {
      const file = event.currentTarget.files?.[0]; if (!file) return;
      setFileCheck(""); void run("Kiểm tra SHA-256", async () => {
        if (file.size > 50_000_000) throw new Error("Chỉ kiểm tra file tối đa 50 MB.");
        const hash = sha256(new Uint8Array(await file.arrayBuffer()));
        const expected = view.chain?.deliveryHash ?? product?.sha256;
        setFileCheck(`${expected ? hash === expected ? "KHỚP" : "KHÔNG KHỚP" : "Chưa có hash đối chiếu"}: ${hash}`);
      });
    }} /></label><p className="mono small">{fileCheck}</p></details>
  </section>;
}

