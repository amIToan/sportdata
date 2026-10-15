# Giấy chứng nhận sự kiện

Mở CMS → Sự kiện → chọn sự kiện → **Giấy chứng nhận**.

1. Chọn **Nhập phôi PDF / ảnh** (PDF, PNG, JPG hoặc WebP, tối đa 20 MB). Với PDF nhiều trang, chọn trang phôi trống. Hệ thống chuyển trang thành ảnh, lưu vào storage của sự kiện và tự nhận A4 dọc/ngang. Phôi phải có tỷ lệ A4, sai lệch tối đa 3%.
2. Chọn một VĐV để xem trước. Thêm vùng chữ, chọn trường dữ liệu và kéo đến vị trí trên phôi. Kéo góc dưới phải để đổi kích thước; có thể nhập vị trí/kích thước chính xác bằng mm. Phím mũi tên dịch 0,5 mm, Shift + mũi tên dịch 5 mm.
3. Chọn phông Times New Roman/Arial, cỡ chữ theo pt, màu, đậm/nghiêng và căn lề. “Nội dung tự nhập” dùng cho câu chữ chung, người ký hoặc chức danh. Tên VĐV, ngày sinh, đơn vị, quốc gia, bộ môn, hạng đấu, tên/thời gian/địa điểm giải và ngày cấp lấy theo dữ liệu tương ứng.
4. **Thành tích** tự điền từ các trận tranh huy chương đã công bố/khóa trên nhánh đấu chính và repechage. Với thể thức chưa xác định được huy chương, BTC nhập nội dung riêng. Có thể sửa và bấm **Dùng kết quả tự động** để bỏ bản sửa. Bấm **Lưu mẫu** để lưu bố cục, ngày cấp, thành tích và độ dịch máy in theo sự kiện.
5. Chọn các chứng nhận cần in. Mỗi VĐV/hạng đấu là một tờ. Danh sách gồm VĐV được chọn vào sự kiện và đăng ký có trạng thái CONFIRMED; lọc theo tên/đơn vị hoặc hạng đấu. “Chọn kết quả” chọn cả các trang theo bộ lọc hiện tại; số lượng đã chọn được hiển thị. Mỗi lần in tối đa 200 tờ.
6. **In thử VĐV đang xem**, sau đó **In chứng nhận đã chọn**. Có thể chọn “Lưu thành PDF” trong hộp thoại in của trình duyệt.

Mặc định chỉ in chữ, dùng với giấy đã có phôi. Bật **In kèm phôi** khi in trên giấy trắng hoặc xuất bản có nền. Phôi luôn hiện trong trình thiết kế để căn vị trí.

## Mẫu chứng nhận Jujitsu

Bấm **Áp dụng mẫu chứng nhận** rồi **Lưu mẫu** để thay bố cục hiện tại bằng mẫu tham khảo. Mẫu sẵn có họ tên in hoa, năm sinh, đơn vị, dòng “ĐẠT … HẠNG …”, tên giải và thời gian viết đầy đủ. Thông tin lấy từ VĐV và sự kiện thực tế. Hạng đấu dùng tên trong danh mục; hãy đặt đủ hạng cân, giới tính, nội dung Gi/No-Gi và lứa tuổi nếu cần thể hiện trên chứng nhận.

Điền **Ngày cấp**, **Địa danh cấp**, **Chức danh người ký**, **Họ tên người ký** cho giải đấu. Mẫu không tự sao chép tên người ký, ngày cấp hoặc địa danh từ ảnh tham khảo. Khi chưa có thành tích, dòng kết quả ghi “THAM GIA THI ĐẤU HẠNG …”. Bố cục đã lưu trước đây chỉ đổi khi BTC bấm áp dụng mẫu.

Trong hộp thoại in chọn A4, tỷ lệ **100% / Kích thước thực**, lề **Không**, tắt đầu/chân trang. Kiểm tra một tờ trước khi in số lượng lớn; không dùng “Vừa trang”. Dùng dịch ngang/dọc (mm) để bù sai lệch máy in. Nội dung quá dài so với vùng chữ sẽ chặn in; tăng vùng chữ hoặc giảm cỡ chữ để sửa.

ADMIN, CONTENT và GAMES_ADMIN có thể chỉnh mẫu và in hàng loạt. READ_ONLY xem mẫu và in thử. API chứng nhận và ảnh phôi yêu cầu đăng nhập CMS. Mẫu này là công cụ bố cục/in, chưa có quy trình phát hành, đánh số tự động, ký số hay xác minh giấy chứng nhận.

## Triển khai và kiểm tra

Migration: `20261015120000_event_certificates`. Chạy migration trước khi khởi động backend mới; Docker local tự chạy `prisma migrate deploy` trong entrypoint. Frontend cần nguồn `apps/backend/src/events/certificate-design.ts` khi build (Dockerfile đã sao chép).

Chạy `npm run prisma:generate`, build cả hai workspace, frontend lint, rồi `node --test apps/backend/scripts/smoke-certificates.mjs`.

Kiểm tra thủ công: nhập PDF/ảnh A4, thay phôi, kéo/resize chữ, lưu và tải lại, thử tên VĐV dài, lọc/chọn qua nhiều trang, in chỉ chữ và in kèm phôi. Căn vật lý với giấy thật phụ thuộc trình điều khiển và vùng in của máy in.
