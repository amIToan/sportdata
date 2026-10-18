# Đối chiếu và quyết định triển khai lịch thi đấu

Ngày: 11/10/2026. Đặc tả: `sportdata-match-scheduling-spec.md` v3, đọc toàn bộ 561 dòng.
Source đối chiếu: HEAD `85430fa`; commit archive `c9ad5486f2bd8050b273e19b1100ff8fce897d07` có trong git local.

Tài liệu này ghi tình trạng triển khai và các quyết định bổ sung; không thay thế đặc tả.

## Quyết định đã chốt trong phiên làm việc

- Bổ sung xử lý cân nặng legacy: khi metadata cân nặng thiếu/không dùng được nhưng tên hạng ghi rõ `-57 kg`, `-63 kg`, `+94 kg`, dùng giá trị kg đó để sắp lịch. Không lấy số tuổi `U21` làm kg và không ghi ngược vào dữ liệu hạng. So sánh số kg trước loại capped/over; hạng tuyệt đối và hạng chưa xác định cân nặng đứng sau các hạng có số kg. Regression tái hiện đúng thứ tự sai `+94 → -57 → -63` khi metadata các hạng nữ bị trống, rồi xác nhận `-57 → -63 → +94` trong mọi vòng với preview và lưu DB.
- Sửa thứ tự giữa Nam/Nữ: các block liền nhau của cùng môn, nội dung, Gi/No-Gi, nhóm tuổi và đai dùng chung thứ tự vòng → cân nặng, không hoàn tất toàn bộ block Nam trước block Nữ. Ví dụ mỗi vòng xếp Nữ -57 kg → Nữ -63 kg → Nam +94 kg, rồi mới sang vòng tiếp theo. Giữ ID block cũ để mốc tiếp tục và cấu hình đã lưu vẫn hợp lệ; chỉ tính lại thứ tự khi preview. Lịch đang áp dụng cần preview và apply lại để cập nhật. Kiểm thử `mixed-gender-scheduling.mjs` tái hiện lỗi cũ, bao phủ cả hai hướng chọn Nam/Nữ, vòng tròn, repechage dưới 6 và loại trực tiếp; kiểm thử DB bổ sung bao phủ lưu lịch, chuyển ngày và mốc trên block cũ.
- Giữ quyền toàn hệ thống: ADMIN/GAMES_ADMIN lập lịch; READ_ONLY chỉ xem. Không thêm cấp quyền User–Event.
- Cập nhật theo yêu cầu mới nhất: bỏ cảnh báo `POTENTIAL_PARTICIPANT_CONFLICT` (hai trận có chung ứng viên đi tiếp), cùng yêu cầu xác nhận của cảnh báo này. Preview mới không sinh cảnh báo; lịch đã lưu và preview cũ trên trình duyệt cũng không hiển thị lại. Giữ kiểm tra VĐV đã xác định, thời gian nghỉ và ràng buộc không xen kẽ hai nội dung. Quyết định này thay thế yêu cầu xác nhận cảnh báo tiềm ẩn trước đây; lịch sử audit đã lưu giữ nguyên.
- Người dùng đã duyệt cả hai bảng thứ tự vòng REPECHAGE/DOUBLE_ELIMINATION dưới đây; adapter đã triển khai theo bảng.
- Cập nhật luồng theo yêu cầu tiếp theo: sau khi chọn ngày/thảm, nội dung và hạng, nhập giờ bắt đầu rồi bấm **Sắp xếp tự động** ngay tại bước đầu. Phần tùy chỉnh cửa sổ/nghỉ/vòng trở thành bước tùy chọn. Lịch mới tự chuẩn bị các ngày từ ngày chọn đến cuối giải trên cùng thảm, cùng giờ bắt đầu; giới hạn giờ kết thúc lấy từ rule của các nội dung (fallback 22:00 như backend). UI hiện rõ các ngày/giờ sẽ dùng. Lịch đã lưu hoặc đã tùy chỉnh giữ nguyên windows, ngày tắt, breaks và pins; không tự ghi đè bằng mặc định mới. Backend tiếp tục xếp mọi trận, kiểm tra rest/reservations và chờ xác nhận apply.
- Yêu cầu bổ sung: một VĐV phải hoàn tất hoặc bị loại hoàn toàn khỏi nội dung đang thi đấu trước khi bắt đầu nội dung khác; khoảng trống giữa các vòng và qua đêm vẫn thuộc nội dung đó. Thua nhưng còn nhánh vớt/nhánh thua chưa phải bị loại. Khi chưa có kết quả, planner giữ toàn bộ khoảng từ trận đầu đến trận cuối mà VĐV có thể tham gia, tự dời nội dung tiếp theo và cộng thời gian nghỉ. Không đủ giờ, có mốc cố định xung đột hoặc thiếu lịch trận còn lại thì chặn apply, không cho xác nhận bỏ qua. Sau khi có kết quả loại hẳn, tính lại lịch có thể giải phóng VĐV sớm hơn.
- Preview hiển thị tên VĐV, nội dung/hạng, số trận và giờ dự kiến liên quan; có nút × để ẩn và nút hiện lại. Đóng thông báo không thay đổi tính hợp lệ của lịch hoặc xác nhận cảnh báo. Kiểm tra khi bắt đầu bảng điểm dùng kết quả thực tế; các đường ghi lịch legacy cũng từ chối xen kẽ khoảng tham gia đã xác định.
- Nhãn vòng REPECHAGE/DOUBLE_ELIMINATION hiển thị `Vòng n – Nhánh thua`, lấy `Match.round` của đúng hạng/nhánh; không hiển thị mã giai đoạn như “Vớt · 8 · nhận người thua”. Nhãn tranh HCĐ/chung kết giữ tên trận. Mốc áp dụng nhiều hạng có số vòng khác nhau ghi rõ từng hạng; thứ tự giai đoạn nội bộ giữ nguyên.
- Bỏ nút “Lịch hiện có” và đường chuyển từ tổng quan lịch sang danh sách cũ. Trận đã có giờ ngoài plan vẫn hiện khoảng chiếm thảm nhưng không có nút mở giao diện cũ. Sau apply, nút chỉnh sửa ghi “Chỉnh sửa lịch”; chỉ khi có thay đổi chưa áp dụng mới ghi “Tiếp tục chỉnh bản nháp”. Khi mở chỉnh sửa, lấy cấu hình và version mới nhất từ máy chủ; lịch công khai chỉ đổi sau apply.
- Thêm “Xoá bản nháp” trong danh sách nháp, chỉ cho ADMIN/GAMES_ADMIN và có xác nhận. DELETE `/scheduling/events/:eventId/plans/:planId/draft` yêu cầu expectedDraftVersion, dùng cùng event lock và transaction. Lịch chưa áp dụng: xoá plan và các preview, giữ Match/draw. Lịch đã áp dụng: xoá preview chưa áp dụng, khôi phục cấu hình/tên/timezone từ revision đang dùng, giữ toàn bộ Match và lịch sử. DraftVersion tiếp tục tăng để chặn tab/preview cũ. Trạng thái có nháp xác định bằng cấu hình khác lịch đang áp dụng hoặc có preview mới hơn chưa áp dụng (kể cả khi quy định/roster thay đổi mà cấu hình giữ nguyên); không chỉ so version của plan. Có audit; không thêm migration.
- Chuyển trận là khoảng đệm mặc định khi tự xếp. Mốc giờ riêng hợp lệ được ưu tiên và có thể rút ngắn khoảng đệm giữa hai trận trong cùng lịch; thời lượng trận, thời gian nghỉ VĐV, hoàn tất nội dung và khoảng thời gian thảm/slot bị chiếm vẫn được kiểm tra. Ghi khoảng chuyển thực tế vào assignment/revision/item để apply và SQL guard nhất quán. Ví dụ trận trước 09:00–09:05, mặc định chuyển 5 phút: có thể đặt trận kế tiếp 09:09, ghi chuyển thực tế 4 phút. Thời gian của trận đã đấu/khóa giữ nguyên.
- “Dời từ đây” thay mốc cố định của chính trận đó bằng mốc không bắt đầu trước; “Cố định giờ” thay mốc không bắt đầu trước riêng của chính trận đó. Drawer mở đúng ngày/giờ đã lưu. Khi giờ thật sự không hợp lệ, lỗi có giờ đã yêu cầu, nguyên nhân, giờ khả dụng được tính lại và nút dùng giờ đề xuất. Không tự ghi đè mốc người dùng khi chỉ xem preview.

## Đề xuất thứ tự vòng nhánh phụ — ĐÃ DUYỆT

Quy tắc đã duyệt: rào chắn từng hàng trong bảng áp dụng cho tất cả hạng của cùng block. Trong mỗi hàng, cân nhẹ trước cân nặng. Hạng không có hàng tương ứng được bỏ qua, không tạo trận. Sau tất cả hàng mới chuyển sang block nội dung tiếp theo.

Không suy giai đoạn từ số VĐV còn lại hoặc số trận thực sau BYE. Khung trong các cột là khung MAIN_TREE liên kết; phải xác minh các cạnh winner/loser và topology trước khi quy đổi.

“Gộp nhánh thua Rn”: các VĐV ở nhánh thua đấu với nhau. “Nhận thua Rn”: ghép người đi tiếp nhánh thua với người thua vòng Rn của nhánh chính. Đây là tên giải thích cho người duyệt; nhãn UI cuối cùng có thể rút gọn.

### REPECHAGE

Áp dụng topology đang được `buildRepechageBracket` sinh, có hai trận HCĐ và chung kết ở MAIN_TREE.

| STT | Giai đoạn | Khung 32: raw round nhánh phụ | Khung 16 | Khung 8 |
|---|---|---:|---:|---:|
| 1 | Nhánh chính R32 | — | — | — |
| 2 | Vớt: gộp người thua R32 | 1 | — | — |
| 3 | Nhánh chính R16 | — | — | — |
| 4 | Vớt: nhận người thua R16 | 2 | — | — |
| 5 | Vớt: gộp sau R16 | 3 | 1 | — |
| 6 | Nhánh chính QF | — | — | — |
| 7 | Vớt: nhận người thua QF | 4 | 2 | — |
| 8 | Vớt: gộp sau QF | 5 | 3 | 1 |
| 9 | Nhánh chính SF | — | — | — |
| 10 | Hai trận HCĐ, nhận người thua SF chéo nhánh | 6 | 4 | 2 |
| 11 | Chung kết nhánh chính | — | — | — |

Khung lớn hơn 32 có các vòng loại nhánh chính R64/R128/... trước hàng 1. Theo source hiện tại, nhánh vớt chỉ lấy năm vòng cuối của MAIN_TREE. Khung nhỏ hơn 8 không áp bảng này; source chuyển REPECHAGE dưới 6 entries sang vòng tròn, phải đọc draw thực đã sinh.

Ví dụ -56kg khung 32 và -77kg khung 8: xếp R32 và R16 của -56kg cùng các giai đoạn vớt tương ứng trước khi đến QF cả hai hạng. Ở hàng 8, round=5 nhánh vớt khung 32 và round=1 nhánh vớt khung 8 cùng giai đoạn; -56kg trước -77kg.

### DOUBLE_ELIMINATION

Áp dụng topology hiện tại: một trận grand final, không tự thêm trận reset final hay thay luật kết quả.

| STT | Giai đoạn | Khung 32: raw round nhánh thua | Khung 16 | Khung 8 |
|---|---|---:|---:|---:|
| 1 | Nhánh chính R32 | — | — | — |
| 2 | Nhánh thua: gộp người thua R32 | 1 | — | — |
| 3 | Nhánh chính R16 | — | — | — |
| 4 | Nhánh thua: nhận người thua R16 | 2 | — | — |
| 5 | Nhánh thua: gộp sau R16 | 3 | 1 | — |
| 6 | Nhánh chính QF | — | — | — |
| 7 | Nhánh thua: nhận người thua QF | 4 | 2 | — |
| 8 | Nhánh thua: gộp sau QF | 5 | 3 | 1 |
| 9 | Nhánh chính SF | — | — | — |
| 10 | Nhánh thua: nhận người thua SF | 6 | 4 | 2 |
| 11 | Nhánh thua: gộp sau SF | 7 | 5 | 3 |
| 12 | Chung kết nhánh thắng | — | — | — |
| 13 | Chung kết nhánh thua: nhận người thua chung kết nhánh thắng | 8 | 6 | 4 |
| 14 | Grand final | 9 | 7 | 5 |

Khung lớn hơn 32 mở rộng cùng mẫu: vòng chính Rn → nhận thua Rn (nếu có) → gộp nhánh thua Rn → vòng chính R(n/2). Khung 4 bắt đầu ở SF; khung 2 cần kiểm tra source graph thực vì generator hiện tại giả định có ít nhất một vòng nhánh thua.

Đây là lựa chọn thứ tự thi đấu đã được người dùng duyệt, không phải sự khẳng định về luật của liên đoàn. Topology chỉ xác định trận nào phụ thuộc trận nào; không quyết định duy nhất việc tranh HCĐ trước hay sau chung kết.

## Kết quả đối chiếu source

| Phần | Hiện trạng và tác động |
|---|---|
| Khác biệt archive → HEAD | Trong các file lịch/draw đã đối chiếu, thay đổi là `assertParticipantsRegistered` trong MatchesService: chấp nhận CompetitionEntry đúng event/category, không cho withdrawn vượt qua bằng legacy links. Phải bảo toàn. |
| MatchesTab | Mặc định list, lọc một category, 50 dòng/trang, polling 5 giây; cần workspace và endpoint riêng lấy toàn bộ snapshot. |
| Model | Chưa có plan/revision/current assignment/ownership. Draw đã có bracketSize. Category chưa có weightKind. |
| BYE | hideByes, hasCompetitionActivity, isGeneratedWalkover dùng predicate khác nhau. Walkover tự động sau progression có thể tăng resultVersion; không dùng riêng resultVersion để nhận diện trận thật. |
| MinRest | autoSchedule và SportSchedulingRule mặc định 60 phút; assertParticipantAvailability đang đặt restMs=0; assertScoreboardReady đã comment kiểm tra actual rest. Cần thống nhất theo đặc tả. |
| Concurrency | drawTransaction và scoreboard START/FINISH dùng advisory lock theo event. Apply phải dùng cùng khóa và kiểm tra snapshot đầy đủ. |
| Legacy | autoSchedule coi startTime=null HOẶC timeSlotId=null là chưa xếp. Không được tái sử dụng predicate này cho planner. |
| Participants | Scheduler cũ chỉ so athleteId/teamId, chưa mở rộng TeamMember. Readiness bảng điểm hiện yêu cầu hai athlete; không thể tự tuyên bố hỗ trợ chấm điểm đội/heat. |
| Slot | Session/TimeSlot đã tồn tại; EXCLUDE không deferrable. Apply phải giải phóng đúng tập lịch có thể đổi trong transaction, không xóa lịch sử. |
| Public | PublicEventStreamInterceptor chỉ nhận auto-schedule trong module scheduling; cần nhận apply mới sau commit. Heat có startTime riêng cần đồng bộ nếu lập lịch Heat. |
| Quyền | User/JWT chỉ có role toàn hệ thống, không có ACL theo event; giữ mô hình này theo trả lời của người dùng. |

## Ma trận dữ liệu và khả năng adapter

Đây là đánh giá source/schema/seed, không phải xác nhận dữ liệu một giải đang chạy hoặc kết quả nghiệm thu tính năng mới. Chưa truy vấn production.

| Nội dung / dạng | Nguồn dữ liệu thực trong source | Điều kiện hỗ trợ |
|---|---|---|
| GI, No-GI, Fighting / MAIN_TREE | Category metadata, Draw.bracketSize, Match winner/loser edges | Xác minh cây đủ topology, cân nặng đã xác định và BYE; dùng semantic stage. |
| REPECHAGE | MAIN_TREE + draw REPECHAGE, loser edges, hai bronze paths | Đã triển khai bảng duyệt; kiểm tra số lượng, vị trí và cạnh thắng/thua; từ chối topology không khớp. |
| DOUBLE_ELIMINATION | MAIN_TREE + loser draw có grand final | Đã triển khai bảng duyệt, kiểm tra topology; không tạo reset final. |
| ROUND_ROBIN_POOL | Generator Matches tạo Draw + RoundRobinGroup + matches | Chuẩn hóa pool rounds trước knockout; không dùng khung loại trực tiếp. |
| ROUND_ROBIN legacy/team | CompetitionsService có thể tạo RoundRobinGroup và Match mà không có Draw | Adapter cần dùng group làm định danh, mở rộng team.members. |
| POOL_WINNER_TREE | Có enum và đường sinh cây từ pool | Pool completion trước knockout; xác minh các nguồn qualifier có trong snapshot. |
| Duo/Show với TEAM + vòng tròn | CompetitionEntry TEAM, TeamMember, MatchParticipant được model và generator hỗ trợ | Có roster thật, kiểm tra từng thành viên; không đổi TEAM thành INDIVIDUAL. |
| Duo/Show với Heat | Heat liên kết Match và HeatLane/CompetitionEntry | Lập lịch lượt/heat hiện có; giữ thứ tự round/sequence, cập nhật Heat.startTime khi apply. |
| Duo/Show seed cũ | Có cặp tên ghép thành athlete, POOL không có draw; seed chủ động bỏ qua tạo draw Duo/Show | Thiếu roster có thể kiểm chứng; không parse tên để giả lập team, không tự sinh pairing. Phải báo không đủ dữ liệu. |
| MULTI_PARTICIPANT/LANE/RELAY | Có enum, participants và entry types | Chỉ hỗ trợ khi có lượt/heat thật và topology xác định được; enum đơn lẻ không đủ chứng minh hỗ trợ. |

## Phần đã triển khai

- `apps/backend/src/scheduling/planner/`: engine thuần, normalize topology, BYE, hạng cân, metadata, đội/thành viên, UTC/window/rules, strict order, markers, pins, reservations, overflow, diff và khoảng chờ.
- `schedule-plans.service.ts`, controller và DTO: snapshot toàn event, tạo/lưu nháp, preview, apply nhiều ngày, version/hash, idempotency, lịch sử và audit. Preview nằm tại `POST /scheduling/events/:eventId/plans/:planId/preview`; UI tạo draft trước preview đầu tiên.
- Current assignment nằm trên `Match`; lịch sử nằm trong revision/items. Category thuộc tối đa một plan đang áp dụng; một plan có thể trải nhiều ngày/thảm.
- Apply dùng SERIALIZABLE + advisory lock event, giải phóng đúng tập Match được phép sửa trước khi gán lại để xử lý EXCLUDE tức thời. Trận đã đấu/đang đấu/khóa và slot bảo vệ không bị giải phóng. Đồng bộ Heat.startTime; draft không ghi Match.
- `apps/frontend/src/components/cms/scheduling/`: overview ngày × thảm, wizard 3 bước, nhiều nội dung, sửa lịch, chuyển ngày, reorder, dời suffix kể cả trận chưa xếp, undo/redo, tính lại preview, diff, acknowledgement, bản nháp local và cảnh báo khi rời tab.
- `EventWorkspace.tsx`: nối workspace, giữ sơ đồ/công cụ legacy. PUBLIC dùng projection Match và stream sau apply. Bảng điểm kiểm tra barrier vòng/nội dung, rest thực tế; chi tiết lịch polling trạng thái và kiểm tra lại VĐV đã resolve.
- Legacy PATCH/delete/revert/auto-schedule/distribute không được sửa lịch managed. Migration có trigger bảo vệ reservation và làm stale snapshot khi dữ liệu liên quan thay đổi.

## Migration và vận hành

Migration mới: `apps/backend/prisma/migrations/20261011090000_match_schedule_plans/migration.sql`.
Thêm 4 bảng plan/revision/item/category ownership, các trường assignment trên Match, Category.weightKind, indexes/constraints và PostgreSQL triggers. Không tự import lịch cũ, không backfill Open từ metadata null.

Trước khi chạy ứng dụng đã cập nhật trên môi trường được chọn:

```sh
npm run prisma:generate
npm run prisma:deploy
```

Trong giai đoạn kiểm thử chỉ deploy migrations vào schema PostgreSQL local dùng một lần, tự xóa sau chạy. Sau khi người dùng báo lỗi thiếu `Category.weightKind` trên ứng dụng local, đã chạy `npm run prisma:deploy` vào database `sportdata`, schema `public`, tại `localhost:5432` ngày 11/10/2026. Cả 6 migration còn thiếu từ `20261010090000_participant_account_identity` đến `20261011090000_match_schedule_plans` đã áp thành công; API đang chạy `GET /api/sports` trả HTTP 200 (10 môn). Giữ nguyên lịch sử migration cũ trong database, không reset dữ liệu. Chưa áp migration production hoặc deploy ứng dụng. Không thay đổi dependency hay thêm test framework.

## Kiểm thử và bằng chứng

Các lệnh đã chạy thành công:

```sh
npm run build --workspace=@sportdata/backend
npm run build --workspace=@sportdata/frontend -- --webpack
npm run lint --workspace=@sportdata/frontend
node tests/regression/match-scheduling-engine.mjs
node tests/regression/match-scheduling-content.mjs
node tests/regression/match-schedule-registration.mjs
node tests/regression/draw-roster.mjs
node tests/regression/draw-seeding.mjs
node tests/regression/match-scheduling-database.mjs --ui
```

Build mặc định frontend bằng Turbopack bị `EPERM` lúc tạo listener trong môi trường chạy này. Build production dùng `--webpack` đã qua compile, TypeScript và tạo routes; không sửa script build mặc định của repo.

| Tầng | Đã kiểm chứng |
|---|---|
| Engine | GI 32/18/8 = 55 trận thật; A 96/90, B 60/108/18, C suffix 55 ngày đầu, D 138/48; strict order, group reorder, cycle, pin, immutable, autoContinue=false/mốc thủ công, ngày tắt, break, gap, rest 60 phút, reservation, candidate TBD và roster đội. Bộ số học dùng rest=0 có chủ đích trong fixture, không đổi mặc định sản phẩm. |
| Hoàn tất nội dung | Không chen GI vào khoảng trống giữa các vòng No-GI, dời toàn bộ đường thi đấu sau nội dung trước và cộng rest; pin/khóa/hết giờ không bỏ qua được. Kết quả thắng còn vòng tiếp theo, thua vào vớt, vòng tròn và thành viên đội đều giữ VĐV trong nội dung; loại hẳn hoặc hoàn tất trận cuối thì giải phóng. DB/API xác nhận dời lịch qua ngày, mô tả có tên VĐV, rollback khi PATCH legacy xen kẽ và readiness chặn/giải phóng theo kết quả thật. |
| Mốc giờ riêng | Engine/DB/API: kết thúc 09:05 → bắt đầu 09:09 được chấp nhận dù mặc định chuyển 5 phút; lưu khoảng thực tế 240 giây vào revision/item và apply thành công. Giữ nguyên thời gian trận khóa; pin 09:04 gây chồng trận bị chặn, có đề xuất 09:05; nghỉ VĐV vẫn được kiểm tra. Browser: đặt pin, mở lại đúng giờ, chuyển sang “Dời từ đây” loại bỏ pin cũ, bỏ mốc và tính lại. Đối chiếu chỉ đọc bản nháp người dùng: #183 giữ 09:09 ngày 12/10/2026, 129/129 trận, canApply=true, không ghi Match khi kiểm tra. |
| PostgreSQL + API | Migrations đầy đủ trên schema tạm, draft isolation, EXCLUDE swap, rollback lỗi giữa transaction, immutable revision, idempotency, optimistic version, stale rule/roster/result, category ownership cạnh tranh, A/B cùng 09:00 khác thảm, shared athlete, legacy collision, bỏ cảnh báo TBD và áp dụng không cần xác nhận cảnh báo này, audit, readiness barrier, protected prefix, JWT/READ_ONLY/plan khác event; xoá nháp mới, hoàn nguyên nháp của lịch applied, giữ Match/lịch sử/audit và chặn tab cũ; kiểm tra lại xung đột khi VĐV được resolve. Public schedule-summary/findOne đọc đúng ngày/giờ/FOP đã apply; interceptor chỉ phát stream khi apply thành công, không phát khi preview hoặc rollback. |
| Adapter | REPECHAGE/DOUBLE_ELIMINATION do generator thật sinh khung 8/16/32, thứ tự mọi cạnh dependency, apply toàn chuỗi và từ chối cạnh sai; Duo TEAM vòng tròn 6 trận, Show TEAM 2 heat và đồng bộ giờ Heat/Match. Không dùng tên ghép thành athlete để giả lập đội. |
| Browser + backend thật | Tổng quan A/B, mở wizard không ghi DB, ba bước/quay lại giữ state, hộp thoại giữ nháp khi đổi sang sơ đồ, overflow khóa Apply và có dời từ trận chưa xếp, đóng thông báo bằng × vẫn khóa Apply và có thể hiện lại, huỷ/xác nhận xoá bản nháp và trở lại nút “Chỉnh sửa lịch”, preview/diff/apply 31 trận, applied+draft, continuation mở ngày 12, browser UTC hiển thị 09:00 Việt Nam; mobile sửa tên lịch applied và đi qua bước 1→2→3→apply bằng bàn phím. |
| Regression cũ | Đăng ký Match/entry/legacy, draw roster, 4.800 trường hợp seeding và khung đến 512. |

Test DB chỉ chấp nhận host localhost/127.0.0.1/::1. UI chạy Next production trên port tạm; scheduling/auth gọi API thật; thông báo ngoài phạm vi được stub. Playwright nằm ngoài repo; đặt `SCHEDULE_PLAYWRIGHT_MODULE` nếu không dùng đường dẫn đã ghi trong script, và `SCHEDULE_CHROME_PATH` nếu không dùng Chrome macOS mặc định.

Ảnh tạo từ dữ liệu QA tạm, không phải dữ liệu production:

- [Tổng quan A/B](../output/qa/match-scheduling/01-overview.png)
- [Bước 1](../output/qa/match-scheduling/02-step-content.png), [bước 2](../output/qa/match-scheduling/03-step-windows.png), [bước 3](../output/qa/match-scheduling/05-step-preview.png)
- [Hết giờ / overflow](../output/qa/match-scheduling/04-overflow.png), [diff](../output/qa/match-scheduling/06-diff.png)
- [Đã áp dụng](../output/qa/match-scheduling/07-applied.png), [tiếp tục qua ngày](../output/qa/match-scheduling/08-continuation.png), [mobile](../output/qa/match-scheduling/09-mobile.png)
- [Preview mobile](../output/qa/match-scheduling/10-mobile-preview.png)
- [Sắp xếp tự động một lần](../output/qa/match-scheduling/11-automatic-preview.png): regression UI đã xác nhận chỉ nhập 09:00 rồi bấm nút ngay tại bước đầu, tự xếp đủ 31 trận qua nhiều ngày; tự lấy giới hạn 10:30 từ rule fixture và chuẩn bị 3 ngày của event, chưa ghi giờ Match trước khi apply. Build frontend/backend, lint, engine và DB/UI regression đã chạy lại thành công sau thay đổi này.

## Kiểm tra thủ công

1. Dùng giải local/staging có FOP, rules và draw thật. Vào Trận đấu → Sắp xếp trận đấu; tạo A ở thảm 1, B ở thảm 2, cùng 09:00 và không chung VĐV. Preview/apply từng lịch; đối chiếu public và bảng điểm.
2. Rút ngắn ngày đầu, thêm ngày kế tiếp; xem continuation cùng planId. Đặt earliest theo vòng và theo trận, thử tắt autoContinue và mốc thủ công từ trận chưa xếp.
3. Mở lịch applied, sửa tên/giờ rồi lưu nháp: public và overview phải giữ giờ/tên applied. Preview lại, kiểm tra diff toàn chuỗi trước apply.
4. Mở cùng plan trên hai trình duyệt; một bên sửa/áp dụng rồi bên kia apply preview cũ phải nhận 409. Kiểm tra cả browser timezone Việt Nam và UTC.
5. Kiểm tra bàn phím qua cả wizard, thiết bị mobile thực, stream public, bắt đầu/kết thúc trận qua bảng điểm thực, TimeSlot/session đã khóa và dữ liệu giải lớn thực tế.

## Giới hạn và phần chưa nghiệm thu tự động

- Khung REPECHAGE/DOUBLE_ELIMINATION khác 8/16/32, POOL_WINNER_TREE, timezone DST và đầy đủ kịch bản TimeSlot/session chưa có test end-to-end riêng trong phiên này. Adapter có validation và từ chối dữ liệu không khớp; không đánh dấu mọi draw/entry enum đã nghiệm thu.
- Không có import legacy hoặc chuyển category trực tiếp giữa hai plan; legacy vẫn xem/sửa theo công cụ cũ và là reservation cứng. Một plan yêu cầu các venue đã chọn cùng timezone.
- Duo/Show chỉ xếp roster TEAM/lượt đã có dữ liệu thật. Không bổ sung hệ thống chấm điểm đội/heat; quyền và khả năng mở bảng điểm cá nhân hiện hữu được giữ.
- Tính năng ngăn mất nháp có hộp thoại cho các tab/link trong ứng dụng, native beforeunload khi reload/rời trang và local recovery; browser Back/Forward, screen reader, thiết bị mobile thực và mọi tổ hợp thao tác bàn phím chưa có automation riêng. Mobile viewport đã chạy luồng chỉnh sửa đến apply.
- UI integration không chạy trang public hoặc bảng điểm đầy đủ. Public service/stream interceptor và readiness đã có regression backend; cần smoke test vận hành toàn trang ở bước 5 trước khi triển khai giải thật. Chưa chạy load test k6 hoặc đo hiệu năng snapshot trên giải lớn.
- Applied history được giữ bằng FK RESTRICT: không xóa Match đã xuất hiện trong lịch sử, kể cả khi sau này bỏ category khỏi lịch. Không có thao tác xóa lịch sử trong UI/API mới.
