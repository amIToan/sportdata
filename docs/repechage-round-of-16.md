# Repechage 1/8

Trong CMS → Sự kiện → Nhánh đấu, chọn **Repechage 1/8**. Thể thức có cấu hình cặp đặt trước và preview riêng (`REPECHAGE_ROUND_OF_16`). Lựa chọn Tuyệt đối / Open Weight được comment trong giao diện.

Với 16 VĐV, nhánh chính gồm 15 trận, tìm HCV/HCB. Nhánh vớt gồm 12 trận:

1. Tám người thua vòng 1/8 đấu bốn trận, giữ riêng nửa bảng A/B.
2. Bốn người thắng gặp bốn người thua tứ kết, đấu bốn trận.
3. Bốn người thắng đấu hai trận, chọn một người thắng vớt mỗi nửa bảng.
4. Thắng vớt A gặp thua bán kết B; thắng vớt B gặp thua bán kết A. Hai người thắng nhận hai HCĐ.

Người thua được chuyển ngay khi kết quả trận được chốt; không phụ thuộc kết quả tiếp theo của người đã thắng họ. Trận chung kết nhánh chính không đưa người thua xuống nhánh vớt.

Dưới 6 VĐV tự động dùng một bảng vòng tròn. Bảng 6–8 VĐV bắt đầu vớt từ tứ kết, xử lý miễn đấu tự động. Bảng lớn hơn 16 VĐV chỉ tiếp nhận người thua từ vòng 1/8; các vòng trước đó loại trực tiếp. Repechage cũ giữ nguyên mốc vòng 32.

Triển khai database bằng `npm run prisma:deploy`, sau đó `npm run prisma:generate` và build/restart backend. Migration `20261012000000_repechage_round_of_16` chỉ bổ sung giá trị enum, không sửa cây đấu có sẵn.

Kiểm tra:

- `npm run build:backend`
- `node tests/regression/repechage-round-of-16.mjs`: sinh cây, luồng kết quả, miễn đấu, HCĐ chéo và mapping xếp lịch; không cần database.
- `node tests/regression/draw-preconfiguration.mjs`: preview/sinh cây/lưu cấu hình qua API, schema PostgreSQL local tạm thời.
- `node tests/regression/match-scheduling-database.mjs`: xếp lịch với schema PostgreSQL local tạm thời.
- `node tests/regression/draw-preconfiguration-ui.mjs`: kiểm tra CMS bằng Playwright với API giả lập; cần frontend đang chạy.
