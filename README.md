# StudentEscrow – Code trong một repo

`student-escrow` là thư mục gốc của repo code, có `.gitignore` riêng. Khởi tạo Git và push từ thư mục này; không khởi tạo repo ở thư mục cha `dvcntc`. Tài liệu ý tưởng/phân công ở thư mục cha không thuộc repo. Thư mục `docs/` bên trong chứa ghi chú kiểm chứng cục bộ và cũng được gitignore; README này giữ lại để hướng dẫn chạy code. Chưa khởi tạo Git hoặc kết nối GitHub trong bước này.

## Phần đang triển khai

**01 – Backend nền tảng đã đạt gate (TV2, kiểm thử cùng TV5):** .NET 10, bốn lớp, SQL Server, migration, đăng ký/đăng nhập JWT, hồ sơ và Swagger. Phần tiếp theo là liên kết ví và KYC mô phỏng; chưa có API xử lý tiền, contract, frontend hoặc AI.

Ghi chú tiến độ và hướng dẫn Swagger chi tiết nằm trong `docs/` trên máy phát triển, không được push. Các bước chạy và kiểm tra API cần thiết nằm ngay trong README này.

Kết quả hiện tại: build sạch, 11 test pass và HTTP public/Swagger chạy được. Người dùng đã chạy full smoke bằng PowerShell thường với SQL thật, tất cả ca PASS; **phần 01 đạt gate**. Lần chạy agent trước đó gặp SSPI, chưa xác nhận lỗi trong phiên công cụ đã hết. Kết quả kiểm chứng chi tiết lưu cục bộ trong `docs/01_VALIDATION.md`.

## Chạy trên Windows PowerShell

Mở terminal ở `student-escrow`. Script chọn .NET ở `$env:USERPROFILE\.dotnet` trước, vì máy hiện có .NET 10 tại đó. Có thể mở `StudentEscrow.slnx` bằng IDE hỗ trợ .NET 10.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dotnet.ps1 --info
powershell -ExecutionPolicy Bypass -File .\scripts\dotnet.ps1 restore StudentEscrow.slnx
powershell -ExecutionPolicy Bypass -File .\scripts\dotnet.ps1 build StudentEscrow.slnx --no-restore
powershell -ExecutionPolicy Bypass -File .\scripts\dotnet.ps1 test StudentEscrow.slnx --no-build
powershell -ExecutionPolicy Bypass -File .\scripts\start-backend.ps1 -NoBuild
```

Swagger: `http://localhost:5180/swagger`. SQL development dùng instance `.\MINHKIEN1`, database mới `StudentEscrowDb`; không dùng database của dự án cũ. Khởi động instance trước. Startup development áp dụng migration vào database này; nếu lỗi, Swagger vẫn mở nhưng `/api/health/ready` trả 503. Phải sửa SQL trước khi coi phần này hoàn thành.

Máy khác: ghi connection string của mình vào biến môi trường `ConnectionStrings__StudentEscrow` hoặc `backend/StudentEscrow.API/appsettings.Local.json` (đã gitignore). Không commit mật khẩu. HTTP + `Encrypt=False` chỉ phục vụ local; triển khai thật cần HTTPS và cấu hình SQL TLS phù hợp.

Nếu tự tạo `StudentEscrowDb` và dùng SQL login, sao chép `appsettings.Local.example.json` thành `appsettings.Local.json` trong thư mục API, rồi điền thông tin thật. Tài khoản kết nối cần quyền migration/đọc/ghi trong database demo. Database rỗng là đủ; API tạo bảng từ migration, không cần tự tạo bảng Users.

Không truy cập được NuGet nhưng đủ package trong cache: chạy restore với `--source "$env:USERPROFILE\.nuget\packages" -p:NuGetAudit=false`. Đây là chế độ offline tạm thời; không có kết quả kiểm tra advisory mạng. Bình thường giữ NuGet audit và nguồn nuget.org.

## Kiểm tra API thật

Giữ API chạy ở terminal đầu; terminal thứ hai:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-api.ps1
```

Script yêu cầu readiness 200, kiểm tra Swagger/JWT, đăng ký/login/profile, email trùng, validation và lỗi 401/404. Mỗi lần chạy tạo một tài khoản `smoke.*@example.test` riêng trong database demo. Không tự xóa dữ liệu hoặc reset database.

Thêm `-PublicOnly` để chỉ kiểm tra HTTP/Swagger/validation/401/404 khi SQL chưa sẵn sàng. Chế độ này không đạt gate SQL và không thay thế smoke test đầy đủ.

Development không đặt `Jwt__SigningKey`: tạo khóa ngẫu nhiên trong bộ nhớ mỗi lần chạy; tài khoản SQL vẫn giữ, token cũ hết hiệu lực sau restart nên login lại. Có thể đặt khóa riêng qua environment để duy trì token. `.env.example` chỉ là mẫu tên biến, ứng dụng không tự đọc `.env`.

Data Protection development cũng dùng bộ nhớ để không đọc/ghi key dùng chung của các dự án khác. Chưa có tính năng cookie cần giữ key qua restart. Production không dùng cấu hình key tạm này.

## Thư mục

```text
backend/      API / Application / Domain / Infrastructure
tests/        test nghiệp vụ và bảo mật tài khoản
scripts/      chọn SDK, chạy backend, smoke test HTTP
docs/         ghi chú cục bộ, không push
```

`blockchain`, `frontend` và `analytics` sẽ được thêm khi đến phần tương ứng, không tạo module giả chỉ để đủ cây thư mục.
