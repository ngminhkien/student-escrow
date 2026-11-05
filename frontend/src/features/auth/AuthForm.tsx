import { useState } from "react";
import type { FormEvent } from "react";
import { login, register as registerAccount } from "../../services/auth";
import type { RunAction, Session } from "../../domain/types";
import { Icon } from "../../shared/ui/Icon";
export default function AuthForm({ busy, run, onSession }: { busy: boolean; run: RunAction; onSession: (session: Session) => void }) {
  const [register, setRegister] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(register ? "Đăng ký" : "Đăng nhập", async () => {
      const input = { email: String(data.get("email") ?? "").trim(), password: String(data.get("password") ?? "") };
      const result = await (register ? registerAccount({ ...input, fullName: String(data.get("fullName") ?? "").trim(), useExternalWallet: data.get("walletMode") === "external" }) : login(input));
      onSession(result);
    });
  }
  return <div className="auth-layout"><aside className="auth-aside"><span className="auth-kicker"><Icon name="shield" size={17} />THỎA THUẬN RÕ RÀNG · KÝ QUỸ MINH BẠCH</span>
    <h2>Hợp tác rõ ràng. Thanh toán an tâm.</h2><p>Không gian giao dịch dịch vụ sinh viên. Từ thỏa thuận đầu tiên đến sản phẩm được nghiệm thu.</p>
    <div className="auth-process"><div className="auth-process-heading"><span>QUY TRÌNH GIAO DỊCH</span><Icon name="arrow" size={18} /></div><ol><li><span><Icon name="orders" size={18} /></span><div><strong>Thống nhất điều khoản</strong><p>Rõ sản phẩm, thời hạn và số tiền.</p></div></li><li><span><Icon name="wallet" size={18} /></span><div><strong>Ký quỹ an toàn</strong><p>Theo dõi trạng thái trên blockchain.</p></div></li><li><span><Icon name="check" size={18} /></span><div><strong>Bàn giao & nghiệm thu</strong><p>Kiểm tra sản phẩm trước khi thanh toán.</p></div></li></ol></div>
    <p className="auth-disclaimer">Môi trường local · Ví và ETH thử nghiệm</p>
  </aside><section className="panel narrow auth-card"><span className="auth-form-icon" aria-hidden="true"><Icon name="wallet" size={26} /></span><p className="page-eyebrow">{register ? "BẮT ĐẦU HỢP TÁC" : "CHÀO MỪNG TRỞ LẠI"}</p><h2>{register ? "Tạo tài khoản" : "Đăng nhập"}</h2>
    <p>{register ? "Tạo tài khoản để bắt đầu giao dịch cùng StudentEscrow." : "Tiếp tục quản lý đơn hàng và các thỏa thuận của bạn."}</p>
    <form onSubmit={submit}>
      {register && <label>Họ tên<input name="fullName" minLength={2} maxLength={100} required autoComplete="name" /></label>}
      <label>Email<input name="email" type="email" required maxLength={254} autoComplete="email" /></label>
      <label>Mật khẩu<span className="password-field"><input name="password" type={showPassword ? "text" : "password"} minLength={register ? 10 : 1} maxLength={128} required autoComplete={register ? "new-password" : "current-password"} /><button type="button" className="password-toggle" aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}><Icon name={showPassword ? "eyeOff" : "eye"} size={18} /></button></span></label>
      {register && <p className="muted">Mật khẩu từ 10 ký tự.</p>}
      {register && <fieldset className="wallet-choice"><legend>Cách giữ ví</legend>
        <label className="wallet-option"><input type="radio" name="walletMode" value="custodial" defaultChecked /><span><strong>Hệ thống giữ ví hộ</strong><small>Không cần cài gì thêm. Số dư tính bằng VND, nền tảng trả phí gas. Nền tảng giữ khóa và ký giao dịch thay bạn.</small></span></label>
        <label className="wallet-option"><input type="radio" name="walletMode" value="external" /><span><strong>Tự giữ ví bằng MetaMask</strong><small>Chỉ bạn giữ khóa, nền tảng không thể ký thay. Nạp bằng VND sẽ nhận ETH thẳng vào ví; bạn tự xác nhận từng giao dịch và trả gas bằng ETH đó. Cần liên kết ví sau khi đăng ký.</small></span></label>
        <p className="small muted">Không đổi được sau khi đăng ký.</p>
      </fieldset>}
      <button disabled={busy}>{busy ? "Đang xử lý…" : register ? "Đăng ký" : "Đăng nhập"}<Icon name="arrow" size={18} /></button>
    </form>
    <button className="text-button" disabled={busy} onClick={() => setRegister(v => !v)}>{register ? "Đã có tài khoản? Đăng nhập" : "Chưa có tài khoản? Đăng ký"}</button>
    {!register && <div className="auth-wallet-note"><Icon name="shield" size={17} /><span>Tài khoản ví hệ thống không cần cài ví. Tài khoản tự giữ ví xác nhận giao dịch trong MetaMask.</span></div>}
  </section></div>;
}
