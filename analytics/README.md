# Transaction Analytics và AI Risk Scoring (phần 06)

Đây là Transaction Analytics quy mô demo, không phải Big Data. Điểm rủi ro chỉ để cảnh báo: không nằm trong contract, không chặn giao dịch, không đổi tiền, trạng thái đơn hay quyền KYC, và Arbiter vẫn phải dựa vào bằng chứng.

```text
analytics/
├── ai/StudentEscrow.RiskTraining/  console sinh dữ liệu, huấn luyện và đánh giá offline
├── ai/model/                       risk-model.zip, metadata.json, metrics.json
└── data/                           risk-dataset.csv (có nhãn), analytics-seed.csv (cho dashboard)
```

Bảng thống kê nằm ở `frontend/src/features/analytics`, trong mục **Thống kê** của Admin.

## Tạo lại mô hình

Chạy từ thư mục gốc repo. Tham số seed là tùy chọn, mặc định `20261105`:

```powershell
.\scripts\dotnet.ps1 run --project analytics/ai/StudentEscrow.RiskTraining -- 20261105 "$PWD"
```

Lệnh này ghi đè `ai/model` và `data`, rồi in `metrics.json`. API chỉ nạp mô hình đã lưu và không huấn luyện theo request. Cùng seed cho cùng dữ liệu (có test kiểm tra); `trainedAt` và hash của tệp mô hình có thể khác giữa các lần chạy.

## Dữ liệu giả lập và cách sinh nhãn

Toàn bộ dữ liệu huấn luyện do `Simulator.cs` sinh ra, **không có dữ liệu giao dịch thật**. Mọi kết quả dưới đây chỉ nói lên khả năng của mô hình trên quy trình giả lập này.

1. Mỗi Seller có một loại ẩn mà đặc trưng không nhìn thấy: `reliable` 65%, `careless` 25%, `risky` 10%. Loại `risky` có tài khoản mới hơn, hoạt động dồn dập và hay có đơn giá trị đột biến.
2. Khả năng một đơn kết thúc xấu là `sigmoid(hệ số theo loại + 1,0 nếu số tiền đột biến + 0,6 nếu Seller dưới 7 ngày tuổi + nhiễu Gauss σ=0,6)`.
3. `RiskLabel` cho biết đơn đó có kết thúc bằng tranh chấp hoặc hoàn toàn bộ hay không, sau đó bị đảo ngẫu nhiên ở 3% số đơn.

Vì vậy nhãn không phải công thức tính từ đặc trưng, nhưng vẫn do nhóm tự đặt ra. Các hệ số này được chọn tùy ý, không dựa trên số liệu thực tế.

## Đặc trưng (`featureVersion = v1`)

| Đặc trưng | Ý nghĩa |
|---|---|
| `AmountEth` | Số tiền đơn, chỉ đổi sang số thực để đưa vào mô hình |
| `BuyerAccountAgeDays`, `SellerAccountAgeDays` | Tuổi tài khoản; không tìm thấy tài khoản thì tính là 0 ngày |
| `SellerPriorFundedCount` | Số đơn khác của Seller đã ký quỹ trước thời điểm chấm |
| `SellerPriorDisputeRate`, `SellerPriorRefundRate` | Tỷ lệ tranh chấp và hoàn toàn bộ đã xảy ra trước thời điểm chấm; mẫu số 0 thì bằng 0 |
| `SellerOrdersLast7Days` | Số đơn đã ký quỹ trong 7 ngày trước đó |
| `AmountToSellerHistoricalMean` | So với trung bình các đơn trước; chưa có lịch sử thì bằng 1 |
| `SellerHistoryMissing` | Cờ chưa có lịch sử, để không coi thiếu dữ liệu là an toàn |

Huấn luyện và API dùng chung `RiskFeatureBuilder`. Mọi sự kiện từ thời điểm chấm trở đi đều bị bỏ qua, và kết quả của chính đơn đang chấm không được tính. API tự lấy đặc trưng từ SQL, thời gian lấy từ block của sự kiện đã xác thực, không nhận đặc trưng từ client.

## Huấn luyện

- `SdcaLogisticRegression` của ML.NET 5.0.1, một luồng và có seed cố định. Chuẩn hóa mean/variance nằm trong pipeline, chỉ fit trên tập train.
- Người dùng được chia train/validation/test **trước khi** sinh giao dịch, nên không ai xuất hiện ở hai tập.
- L2 và ngưỡng chọn trên validation. L2 chọn theo ROC-AUC, ngưỡng chọn theo F1. Tập test chỉ dùng để đo.

| Tập | Đơn | Seller | Tỷ lệ nhãn dương |
|---|---:|---:|---:|
| Train | 1.650 | 210 | 21,1% |
| Validation | 577 | 70 | 27,7% |
| Test | 545 | 70 | 22,4% |

## Kết quả trên tập test

Seed `20261105`. Số liệu đầy đủ ở `ai/model/metrics.json`.

| | ROC-AUC | Ngưỡng | TP | FP | TN | FN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Mô hình, ngưỡng mặc định | 0,764 | 0,50 | 53 | 16 | 407 | 69 | 0,768 | 0,434 | 0,555 |
| Mô hình, ngưỡng validation | 0,764 | 0,25 | 73 | 49 | 374 | 49 | 0,598 | 0,598 | 0,598 |
| Baseline, mức MEDIUM | 0,778 | 40 điểm | 44 | 11 | 412 | 78 | 0,800 | 0,361 | 0,497 |
| Baseline, ngưỡng validation | 0,778 | 20 điểm | 79 | 47 | 376 | 43 | 0,627 | 0,648 | 0,637 |

**Mô hình không tốt hơn baseline theo luật trên tập test.** ROC-AUC và F1 ở ngưỡng chọn từ validation đều thấp hơn baseline. Mô hình chỉ có F1 cao hơn khi so ngưỡng mặc định 0,5 với mức MEDIUM của baseline, và đó là hai ngưỡng không tương đương nhau. Tập test đã được xem nên không chỉnh tiếp simulator hay mô hình để đảo kết quả này; muốn cải tiến phải có tập test mới.

API vẫn dùng mô hình vì đặc tả yêu cầu mô hình ML thật. Baseline là phương án dự phòng và mốc so sánh.

Phân bố mức trên 545 đơn test: mô hình LOW 467, MEDIUM 38, HIGH 40; baseline LOW 490, MEDIUM 53, HIGH 2. Các mức chỉ để minh họa, chưa hiệu chuẩn trên dữ liệu thật.

## Baseline theo luật

Tài khoản Seller dưới 7 ngày +20. Tranh chấp trên 20% +25, hoàn tiền trên 20% +15, số tiền trên 3 lần trung bình +25; ba luật này cần ít nhất 5 đơn trước đó. Hơn 10 đơn trong 7 ngày +15. Tổng giới hạn trong 0–100. Ngưỡng được ghi trong `metadata.json`.

## API

**`GET /api/orders/{id}/risk`** chỉ dành cho Admin; tài khoản khác, kể cả Buyer, Seller và Arbiter của đơn, nhận 403. Đây là quyết định của nhóm, khác với gợi ý hiển thị cho các bên trong tài liệu phân công. Panel rủi ro chỉ hiện ở các đơn Admin mở được trong mục **Phân xử**.

```json
{ "score": 95, "level": "HIGH", "reasons": ["..."], "reasonSource": "rule-based", "scoringSource": "ml",
  "modelVersion": "logistic-v1", "featureVersion": "v1", "evaluatedAt": "...", "dataSource": "synthetic" }
```

| `scoringSource` | Khi nào |
|---|---|
| `ml` | Mô hình chấm được |
| `rule-based` | Thiếu mô hình, tệp sai hash, sai `featureVersion` hoặc lỗi khi dự đoán; `modelVersion` là null |
| `unavailable` | Không tính được đặc trưng; `score` là null và `level` là `UNAVAILABLE`, không mặc định là rủi ro thấp |

`reasons` luôn là các điều kiện theo luật (tối đa 3), không phải yếu tố mô hình đã cân nhắc. Mỗi khi kết quả đổi, một dòng được ghi vào bảng `RiskAssessment` kèm đặc trưng đã dùng.

**`GET /api/analytics/summary?source=chain|synthetic&deploymentId=`** chỉ dành cho Admin. Dữ liệu `chain` và `synthetic` không bao giờ bị cộng chung.

## Định nghĩa chỉ số

| Chỉ số | Định nghĩa |
|---|---|
| Đơn từng ký quỹ | Có sự kiện `Deposited`, loại đơn chưa nạp |
| Giao dịch on-chain | Số mã giao dịch khác nhau có sự kiện của contract; giao dịch không phát sự kiện thì không được đếm |
| Tổng giá trị và giá trị trung bình | Mỗi đơn tính một lần |
| Tỷ lệ hoàn thành | Đơn `Completed` / đơn từng ký quỹ |
| Tỷ lệ tranh chấp | Đơn từng `Disputed` / đơn từng ký quỹ, gồm cả đơn đã `Resolved` |
| Tỷ lệ hoàn toàn bộ | `buyerRefundWei = amountWei` / đơn từng ký quỹ, gồm cả phân xử hoàn 100% |
| Phân bố rủi ro | Mỗi đơn được chấm tại thời điểm ký quỹ, nên biểu đồ không đổi khi các đơn sau quyết toán |

Đơn đang xử lý vẫn nằm trong mẫu số. Các tỷ lệ có thể chồng lấn nên không cộng thành 100%. Mẫu số 0 hiển thị "Chưa có dữ liệu".

Loại dịch vụ là nhãn ngoài chain, người tạo đơn chọn khi lưu nháp, và không nằm trong điều khoản được băm. Đơn không có nhãn hiện là "Chưa phân loại".

## Kiểm chứng

```powershell
.\scripts\dotnet.ps1 test StudentEscrow.slnx
cd blockchain; npm run smoke:risk   # cần API trên database dùng một lần, xem đầu tệp smoke-risk.ts
```

## Hạn chế

- Dữ liệu giả lập do nhóm tự đặt quy tắc, nên mô hình có thể chỉ học lại các giả định đó. Chưa kiểm chứng trên dữ liệu thật.
- Điểm số không phải xác suất gian lận. Nó chỉ gắn với nhãn giả lập `RiskLabel`.
- Quy mô và tỷ lệ đơn trên chain demo rất khác dữ liệu huấn luyện, nên điểm trên chain chỉ để minh họa.
- Chưa đánh giá thiên lệch hay độ trôi dữ liệu. Trong thực tế cần cân nhắc thêm quyền riêng tư.
- Block đồng bộ trước migration này có `Timestamp = 0`, làm lệch số đơn 7 ngày và thời điểm chấm. Chạy `scripts/demo-run.ps1` để có chain mới; worker không tự bổ sung cho block cũ.
- Mỗi lần chấm tải toàn bộ lịch sử của deployment. Cách này chỉ phù hợp với quy mô demo.
