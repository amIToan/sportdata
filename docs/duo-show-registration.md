# Đăng ký cặp DUO / SHOW

- Chọn DUO hoặc SHOW, chọn hạng đấu rồi khai báo đồng đội. Mỗi nội dung có đồng đội riêng; A có thể thi DUO với B và SHOW với C.
- Đồng đội có thể là hồ sơ mới hoặc hồ sơ đã lưu. Hồ sơ đã lưu được tìm bằng số giấy tờ và xác nhận qua số điện thoại cũ hoặc họ tên/ngày sinh; không tạo VĐV trùng.
- Người khai báo nội dung là người chịu phí. Hồ sơ của đồng đội trong cặp có phí bằng 0, trạng thái thanh toán `NOT_REQUIRED`. Nếu đồng đội tự khai báo thêm nội dung khác, nội dung đó có phí riêng.
- Cả hai VĐV cần hồ sơ và giấy tờ hợp lệ. Cặp được xác minh để thi đấu khi cả hai đăng ký được xác nhận và phí người khai báo đã hoàn tất. Thu hồi phí, từ chối hồ sơ hoặc giấy tờ sẽ rút suất thi đấu của cặp.
- Hai hồ sơ liên kết qua `EventRegistration.teamId`; `isPairPayer` xác định người chịu phí. Một `Team` có hai `TeamMember`, một `CompetitionEntry` loại `TEAM` cho hạng đấu.
- Bốc thăm nhận mã đội và lưu các trường `team1Id`, `team2Id`, `winnerTeamId`, kể cả miễn đấu. Lịch sử dụng cả mã đội và mã từng thành viên để kiểm tra trùng lịch/nghỉ giữa trận.
- Màn hình bảng điểm của trận theo cặp chuyển sang nhập điểm DUO/SHOW; có chọn cặp thắng và các bước xác nhận trọng tài, phê duyệt, công bố, khóa theo luồng kết quả hiện có. Bảng kết quả công khai chỉ tính kết quả cặp đã công bố/khóa.
- Mỗi VĐV vẫn có thẻ cá nhân. CMS hiển thị tên cặp, người chịu phí và trạng thái đủ điều kiện.

## Dữ liệu và vận hành

Chạy `npm run prisma:generate` và `npm run prisma:deploy` khi triển khai. Migration bổ sung liên kết đội và người chịu phí, không tự ghép các hồ sơ DUO/SHOW cũ vì không thể xác định đồng đội từ dữ liệu cá nhân. Hồ sơ cũ chưa ghép cần được ban tổ chức xử lý và khai báo lại theo cặp.

Đổi hạng đấu của hồ sơ theo cặp cần khai báo lại cả cặp. Khi chưa có nhánh/lịch thi đấu, xóa đăng ký của một thành viên sẽ xóa đăng ký của cả cặp và suất đội; hồ sơ VĐV được giữ. Sau khi có nhánh/lịch, cần thu hồi nhánh/lịch trước khi xóa.

## Kiểm tra

- `npm run build:backend`
- `npm run build --workspace=@sportdata/frontend -- --webpack`
- `npm run lint --workspace=@sportdata/frontend`
- `node tests/regression/multi-discipline-registration.mjs`
- `node tests/regression/draw-preconfiguration.mjs` (schema PostgreSQL tạm trên localhost)
- `node tests/regression/match-scheduling-content.mjs`
- `node tests/regression/pair-registration-ui.mjs` (API giả lập, Chrome và Playwright local)
