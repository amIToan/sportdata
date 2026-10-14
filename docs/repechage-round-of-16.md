# Quaterfinals Repechage

CMS → Sự kiện → Nhánh đấu: **Quaterfinals Repechage** (`REPECHAGE_QUARTERFINALS`).

Vòng đấu xác định theo cấu trúc bảng. Thua trước tứ kết bị loại; chỉ bốn người thua tứ kết vào hai trận vớt: TK1/TK2 vào A, TK3/TK4 vào B. Hai trận vớt chỉ được bắt đầu khi cả hai bán kết hoàn tất và xác nhận kết quả.

Thắng vớt A gặp thua bán kết 2; thắng vớt B gặp thua bán kết 1. Hai người thắng nhận HCĐ, không đấu thêm. Bảng đủ 8 VĐV có 11 trận; bảng 16 có 19 trận. Dưới 6 VĐV vẫn dùng vòng tròn. Bye không tạo người thua.

Khi sửa người thắng, kết quả phía sau bị ảnh hưởng được hủy và lưu revision. Các nguồn thắng/thua được cập nhật lại.

Chạy `npm run prisma:deploy`, `npm run prisma:generate`, build và restart cả hai ứng dụng. Migration `20261014000000_quarterfinal_repechage` đổi enum cũ và xóa preview đã lưu để yêu cầu preview lại. Migration không viết lại cây đấu đã sinh: cây 1/8 cũ cần được tạo lại trước khi thi đấu. Không tự sửa cây đã có lịch sử thi đấu.

Kiểm tra: `node tests/regression/repechage-round-of-16.mjs`, `node tests/regression/match-scheduling-database.mjs`, `node tests/regression/draw-preconfiguration.mjs` sau build backend.
