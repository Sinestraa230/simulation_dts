# Sơ đồ khối sống · Mạch đèn giao thông ngã tư (Bài 11 – Điện tử số)

Trang web tĩnh mô phỏng **chính mạch đã vẽ trên LogicWorks**: mỗi chân IC, mỗi dây đều là thật, được tính bằng một bộ mô phỏng logic hướng sự kiện 3 trị (0 / 1 / X) có độ trễ lan truyền. Không dùng thư viện ngoài, không cần build.

## Triển khai lên Netlify
1. Đẩy nguyên thư mục này lên repo.
2. Netlify → *Add new site → Import from Git*, để trống Build command, Publish directory = `.` (đã khai trong `netlify.toml`).
3. Muốn xem thử trên máy: `python3 -m http.server` rồi mở `http://localhost:8000`. Mở trực tiếp `index.html` (file://) cũng chạy được vì mọi script đều là script thường.

## Cấu trúc
| File | Vai trò |
|---|---|
| `index.html`, `css/` | Giao diện (nền tối, màu tín hiệu tương phản cao) |
| `js/circuit.js` | **Netlist duy nhất**: linh kiện, số chân, tên dây — khớp bảng nối chân trong hướng dẫn vẽ LogicWorks |
| `js/engine.js` | Bộ mô phỏng: cổng, 74LS74, 74LS192, 74LS157; X lan truyền kiểu "bi quan" như LogicWorks |
| `js/layout.js` | Vị trí linh kiện, tọa độ từng chân, khung khối |
| `js/routes.js` | Đường dây đã đi sẵn (sinh tự động, không sửa tay) |
| `js/render.js` | Vẽ SVG: tô màu dây, xung chạy dọc dây, LED 7 đoạn, đèn, probe, zoom/kéo |
| `js/timing.js` | Giản đồ thời gian trực tiếp (canvas) |
| `js/intersection.js` | Ngã tư thu nhỏ, xe dừng/đi theo đèn của mạch |
| `js/tests.js` | Kịch bản Test 1–5 (chạy sống + tự kiểm) |
| `js/app.js` | Ghép tất cả, điều khiển, thẻ chi tiết, chú thích |
| `tools/route.js` | Đi dây tự động (A*). Chạy lại sau khi đổi vị trí linh kiện: `node tools/route.js` |
| `test/verify.js` | Kiểm chứng engine hàng nghìn ca: `node test/verify.js` |
| `test/selftests.js` | Chạy 5 kịch bản tự kiểm trong Node |

## Cách dùng trên trang
- **Bật nguồn**: mọi dây ban đầu là X (đỏ nhấp nháy); mạch đang bị giữ RESET nên sau 2–3 nhịp tất cả về giá trị rõ.
- **Tốc độ**: *Thực 1 Hz* (1 nhịp CLK = 1 giây), ×4, ×16, *Chậm · xem trễ* (bỏ qua khoảng lặng, chạy chậm khi còn tín hiệu đang lan truyền), *Từng sự kiện* (nút "Sự kiện kế" / "Cạnh CLK kế").
- **Bấm vào IC, cổng, dây hoặc huy hiệu tròn trên dây** để xem thẻ chi tiết với giá trị từng chân đang sống. Thẻ HEX có bảng giải mã BCD → a–g của 74LS247.
- Công tắc TX0–TX7, TV0–TV3 và nút RESET ở cột trái bấm được; ô T<sub>X</sub>, T<sub>V</sub> trên thanh điều khiển đặt các công tắc này.
- **Test 1–5**: chạy lại kịch bản trong báo cáo trên sơ đồ, đồng thời hiện danh sách tiêu chí đạt/không đạt do mô phỏng nhanh tự kiểm.
- Cuộn chuột để phóng to, kéo để di chuyển, bấm đúp để về toàn mạch. Phím cách: tạm dừng/tiếp tục.

## Phạm vi và giới hạn (nói thẳng)
- 74LS247 **không** vẽ thành IC riêng: HEX vẽ như LED 7 đoạn thật, ghi "74LS247 + LED 7 đoạn", bấm vào để xem bảng giải mã (chức năng mạch không phụ thuộc phần này).
- Bus số (NU, NC, CU, CC, TX, TV) vẽ thành từng dây riêng, tô màu xanh dương; không có chế độ gộp/xổ bus.
- Độ trễ trong engine là **tỉ lệ gần đúng** của 74LS (cổng ≈ 10 ns, flip-flop ≈ 20 ns, bộ đếm ≈ 30 ns), không phải số liệu datasheet từng chân.
- Ngã tư thu nhỏ chỉ minh họa; xe di chuyển theo đèn nhưng không phải mô hình giao thông.

## Kiểm chứng
`node test/verify.js` chạy: 7.585 ca nhả RESET (độ trễ cố định và ngẫu nhiên theo loại IC, 6 cặp T<sub>X</sub>/T<sub>V</sub>, 61 thời điểm nhả), 522 ca độ trễ bằng nhau, 2.400 ca bấm RESET giữa chừng — đều 0 lỗi (đúng thứ tự pha, đúng độ dài pha, không X sau khi nhả, đèn đúng bảng).

Lưu ý khi giả định hai bộ đếm 74LS192 có độ trễ rất khác nhau (không thực tế cho hai IC cùng loại): ở lần nạp đầu tiên sau RESET, xung BOR có thể đến U3 sau khi LOAD đã nhả và làm T<sub>X</sub> = 25 bắt đầu từ 15. Kiểm tra "stress" của `verify.js` in ra thông tin này. Với hai IC cùng loại và NOR-8 chậm hơn BOR (như CD4078B), tình huống này không xảy ra.
