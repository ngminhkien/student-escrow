import { useState } from "react";
import type { FormEvent } from "react";
import { login, register as registerAccount } from "../../services/auth";
import type { RunAction, Session } from "../../domain/types";
export default function AuthForm({ busy, run, onSession }: { busy: boolean; run: RunAction; onSession: (session: Session) => void }) {
  const [register, setRegister] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(register ? "Đăng ký" : "Đăng nhập", async () => {
      const input = { email: String(data.get("email") ?? "").trim(), password: String(data.get("password") ?? "") };
      const result = await (register ? registerAccount({ ...input, fullName: String(data.get("fullName") ?? "").trim() }) : login(input));
      onSession(result);
    });
  }
  return <div className="auth-layout"><aside className="auth-aside"><p className="page-eyebrow">STUDENT ESCROW</p><h2>Hợp tác rõ ràng.<br />Thanh toán an tâm.</h2><p>Một quy trình minh bạch từ thỏa thuận đến nghiệm thu dịch vụ.</p><ol><li>Liên kết tài khoản với ví MetaMask của bạn.</li><li>Thống nhất điều khoản và ký quỹ trên blockchain.</li><li>Giao sản phẩm, kiểm tra và xác nhận nghiệm thu.</li></ol><p className="muted">Môi trường thử nghiệm local. Chỉ dùng ví và ETH thử nghiệm.</p></aside><section className="panel narrow auth-card"><h2>{register ? "Tạo tài khoản" : "Đăng nhập"}</h2>
    <p>Đăng nhập để tiếp tục. Ứng dụng sẽ tự kiểm tra và yêu cầu kết nối đúng ví MetaMask của bạn.</p>
    <form onSubmit={submit}>
      {register && <label>Họ tên<input name="fullName" minLength={2} maxLength={100} required autoComplete="name" /></label>}
      <label>Email<input name="email" type="email" required maxLength={254} autoComplete="email" /></label>
      <label>Mật khẩu<input name="password" type="password" minLength={register ? 10 : 1} maxLength={128} required autoComplete={register ? "new-password" : "current-password"} /></label>
      <button disabled={busy}>{register ? "Đăng ký" : "Đăng nhập"}</button>
    </form>
    <button className="text-button" disabled={busy} onClick={() => setRegister(v => !v)}>{register ? "Đã có tài khoản? Đăng nhập" : "Chưa có tài khoản? Đăng ký"}</button>
  </section></div>;
}
