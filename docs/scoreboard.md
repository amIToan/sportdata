# Match scoreboard

Open **CMS → Sự kiện → Trận đấu**, then select the **▶ Bảng điểm** button. The screen at `/cms/matches/[id]/scoreboard` follows `sportdata-scoreboard.html`: red/blue gradient athlete rows (40.5% each) and a 19% footer, with the separator removed. It uses browser Arial, compact portrait avatars (4:6) in place of flags, athlete names, the athlete's federation/club with country fallback, advantages and cumulative penalty indicators. The footer shows the actual mat name, the supplied Grappling Vietnam Academy logo image, remaining time, category, weight limits and round/match number. The original template VR card is hidden initially and appears only for the side with a pending review, with an outline. It hides after resolution; retained or forfeited eligibility is still stored on the server. Scoring is operated entirely by keyboard; score and advantage displays are not mouse buttons.

## Operating a match

1. Schedule two distinct athletes, an FOP, and a start/end time. Both feeder matches must be finished. The start time must have arrived, the FOP and athletes must be free, and scheduling/rest constraints must pass. A notice explains any blocker.
2. Press **Space** to start. Opening the screen alone does not start a match.
3. Use the scoring shortcuts below. Penalty shortcuts enter successive **1P → 2P → 3P → 4P** stages, with active stages highlighted per athlete. **Right-click**, **U**, or **Ctrl/Cmd+Z** reverses the latest active award; the original stays in the history. Submission pauses the clock and proposes the submitting athlete as winner, requiring explicit confirmation to save.
4. Press **Space** to pause/resume as directed by the referee. The clock is saved on the server and survives reloads. Network loss disables controls; elapsed time continues from the saved timestamp. Zero time does not automatically finalize the result.
5. At zero time, press **R** to open result confirmation. Submission, 4P and reaching 50 points open it automatically. Check the winner and method, then confirm. The popup selects the server-calculated winner by athlete ID and follows updated results. Conflicting winner choices are unavailable, and the win method follows the calculated outcome. If every tie-break is equal, the referee must choose a winner using **Quyết định trọng tài**. Saving waits until that athlete's name is loaded. Result saving and winner/loser destination updates are atomic. Existing destination slots are used; occupied or started destinations reject changes. The next match stays scheduled and requires a separate manual start.

## Maximum score and submission

Each athlete's score is capped at 50. Submission sets the submitting athlete's saved score to 50 and retains **SUBMISSION** as the win method. The first athlete to reach 50 through points wins by **POINTS**, including automatic opponent points from 3P. For example, 48 + 4 becomes 50. The clock stops and scoring/resume are blocked until the result is confirmed or the last award is undone. Winner and method are selected automatically; confirmation still requires **Xác nhận & lưu kết quả**.

New scoring actions record the score before and after, alongside the requested button and opponent benefit. Undo restores the exact previous score (48 in the example), rather than subtracting the requested 4 from 50. Legacy actions without this metadata retain their previous undo behavior.

## Bảng tóm tắt phím điều khiển

| Thao tác | Đỏ | Xanh / phím chung | Ghi chú |
| --- | --- | --- | --- |
| Cộng 2 điểm | Q | I | |
| Cộng 3 điểm | W | O | |
| Cộng 4 điểm | E | P | |
| Cộng 1 lợi thế | A | L | L là lợi thế Xanh, không phải LUTE |
| Ghi lần phạt tiếp theo | S | K | Theo thứ tự 1P → 2P → 3P → 4P |
| Submission | Shift+D | Shift+J | Đặt điểm người thắng thành 50, mở xác nhận |
| Bắt đầu / hủy LUTE | Z | T | Hủy về 00:00; lần tiếp theo đếm lại 00:10; đồng hồ trận vẫn chạy |
| Bắt đầu / tạm dừng / tiếp tục timer y tế | M | N | Đồng hồ trận dừng; tối đa 2 phút cộng dồn mỗi VĐV |
| Yêu cầu xem lại video (VR) | V | B | Cần còn quyền khiếu nại; dừng đồng hồ trận |
| Khiếu nại đúng / trả thẻ VR | — | C | Áp dụng cho bên đang yêu cầu VR |
| Khiếu nại sai / thu thẻ VR | — | X | Áp dụng cho bên đang yêu cầu VR |
| Hoàn tác thao tác VR | — | Shift+U | Tách biệt với hoàn tác điểm/phạt |
| Bác sĩ/trọng tài cho phép tiếp tục | — | G | Kết thúc kiểm tra y tế; dùng Space để chạy lại trận |
| Không thể tiếp tục do y tế | — | Shift+G | Đề xuất đối thủ thắng, mở popup xác nhận |
| Hoàn tác quyết định y tế | — | Shift+M | Không hoàn lại thời gian y tế đã dùng |
| Bắt đầu / tạm dừng / tiếp tục trận | — | Space | Không tiếp tục khi VR hoặc y tế chưa được xử lý |
| Hoàn tác điểm/phạt gần nhất | — | U / Ctrl+Z / Cmd+Z | Có thể dùng chuột phải; không hoàn tác VR/y tế |
| Mở popup xác nhận kết quả | — | R | Khi hết giờ hoặc đã có kết quả kết thúc sớm; không tự lưu |
| Bật / tắt toàn màn hình | — | F | |
| Mở lịch sử trận ở tab mới | — | H | Trang sửa trận, mục lịch sử trọng tài |
| Đóng popup xác nhận | — | Esc | |
| Di chuyển trong popup | — | Tab / Shift+Tab | |
| Thao tác với trường hoặc nút đang focus | — | Enter | Muốn lưu kết quả, focus nút “Xác nhận & lưu kết quả” rồi nhấn Enter |

Giữ phím không lặp thao tác. Phím chấm điểm bị chặn khi đang nhập liệu, mở popup, mất quyền điều khiển, đang lưu hoặc trận đã kết thúc. Trong popup, dùng Tab/Shift+Tab và Enter. Khi đang kiểm tra y tế, không chấm điểm; hết thời gian y tế cũng không được dùng lại timer.

The on-screen **Phím tắt** section has been removed. Attack activity remains removed.

## Video replay challenges

The eligibility rule follows [JJIF Ne-Waza v2.8.1, section 5.13](https://www.ju-jitsu.sport/fileadmin/jjif/media/downloads/Rules/JiuJitsu/JJIF_Jiu-Jitsu_Rules_V_2.8.1_-_English.pdf): accepted challenges retain eligibility; rejected challenges forfeit it for the rest of the event, with a reset upon reaching a gold or bronze medal match. The state follows the athlete ID across sides and categories in the same event. Gold is a terminal FINAL match; bronze is a terminal ELIMINATION match in the REPECHAGE bracket. Earlier rounds leading to another match do not reset eligibility. A rejection within the medal match removes the new card too.

**V** requests review for Red; **B** requests it for Blue. Requests stop the clock. Only one challenge may be pending. While review is pending, **C** records an accepted challenge and returns the card; **X** rejects it and removes the card. A compact status notice at the top shows the pending side and these keys. Scoring/undo remain available to correct the decision, while resume and result confirmation wait for resolution. Resolving VR does not alter scores automatically or restart the clock; use scoring keys to enter the referee's corrections and **Space** to resume afterwards.

**U / Ctrl/Cmd+Z / right-click** undo scoring separately from VR. **Shift+U** undoes the latest VR entry to correct an accidental request or decision; undoing a resolution returns it to pending, and undoing a request cancels it. Requests, decisions, corrections and actors remain in the match history and result revisions. Eligibility is reconstructed from active history, so reloads, tab changes and match progression preserve it. All VR commands use the existing control lease/version checks; event locks serialize VR changes with match starts and finishes. No database migration is required.

## Stalling and medical timers

Each athlete row has **one time-only countdown** at its bottom-right corner, flush with the right edge. It starts at `00:00` and switches between LUTE (`00:10`) and the remaining medical allowance (`02:00` initially); there are no separate visible LUTE/medical rows or labels. Medical assessment takes priority in this shared display. The recent mode persists through reload, and a resumed LUTE countdown takes over when the match resumes. **Z** toggles the Red stalling countdown; **T** toggles Blue. Starting requires a running match and starts a fresh 10 seconds. Cancelling resets the display to `00:00` without a penalty; the next start begins a fresh `00:10`. LUTE time is not cumulative. The main clock keeps running. At expiry, the backend records one next penalty using this scoreboard's existing progression, including opponent benefits and the 4P result. It does not start another countdown automatically. Pause, VR and medical checks freeze active stalling timers; resume continues their remaining time. A manual penalty cancels that side's pending countdown to prevent duplicate punishment. A countdown extending beyond the end of the match does not produce a penalty.

Medical time is **two minutes cumulative per athlete**, based on [JJIF Ne-Waza v2.8.1, sections 13.2 and 14.1](https://www.ju-jitsu.sport/fileadmin/jjif/media/downloads/Rules/JiuJitsu/JJIF_Jiu-Jitsu_Rules_V_2.8.1_-_English.pdf). **M** starts/pauses/resumes Red's medical timer; **N** does the same for Blue. Starting medical assessment pauses the main clock and any stalling countdowns. Pausing medical time does not end the assessment. **G** records the referee/doctor's FIT decision and ends the assessment; **Shift+G** records UNFIT and proposes the opponent as winner by the existing withdrawal method (`WALKOVVER`), with an explicit medical reason. The result still requires confirmation. **Shift+M** corrects the last medical decision, without restoring time already consumed.

At zero medical time, the timer becomes exhausted and cannot be used again, including after a FIT decision. Per the requested workflow, exhaustion itself waits for a doctor/referee decision and does not automatically declare a loss. The match cannot resume, be scored or be finalized while assessment remains unresolved. After a FIT decision, **Space** resumes the match; the next medical session uses only the remaining allowance. One medical assessment is active at a time, with separate allowances for both athletes.

Timer timestamps and medical allowances persist in `resultData.scoreboard.auxiliaryTimers`; reloads preserve them. A backend worker checks due timers every 500ms, so stalling penalties and medical exhaustion do not depend on an open browser or a live control lease. Expiry transactions recheck the saved timer/version under the match row lock and record the initiating operator in the audit trail. Undo scoring reverses automatic penalties but does not rearm an expired countdown. No database migration is required.

Winner calculation checks submission/disqualification, then points, advantages, and fewer penalties. If these are equal, the referee chooses either athlete with **Quyết định trọng tài**. Attack activity is no longer accepted by the API or used to break ties. Existing attack records remain in history and do not affect winner calculation; saved results are not rewritten.

**Space** starts/pauses/resumes, **right-click / U / Ctrl/Cmd+Z** undo, **R** opens result confirmation when eligible, **F** toggles fullscreen, and **H** opens history in a separate tab. **Escape** closes confirmation; Tab and Enter retain their normal behavior inside the popup. Holding a key does not repeat commands. Shortcuts are ignored during text entry or while confirmation is open. Updates also require an editable match, ownership of its control lease, and no command in flight. Finished matches remain read-only, with fullscreen and history available.

## Match history

The **Lịch sử thao tác trọng tài** card appears immediately after **Kết quả từ bảng điểm**, before **Thông tin trận đấu**, at `/cms/matches/[id]/edit`. It uses the match data already fetched by that page and refreshes every three seconds. **Lịch sử trận** and **H** on the scoreboard open this page at its history section in a separate tab. The table shows newest actions first, athlete/corner, timestamp, remaining time, automatic opponent benefits, and undone status. Viewing history does not claim the scoreboard lease.

## Sửa kết quả và tính lại cặp đấu

Trong **Sự kiện → Trận đấu → Mở lịch**, mỗi trận có nút **Chi tiết trận**, kể cả trận đã kết thúc hoặc đã khóa lịch. Nút này mở trang sửa trận và giữ đường dẫn quay lại sự kiện. Các trận chưa xếp cũng có nút chi tiết.

Với trận đã kết thúc và đủ hai VĐV, ADMIN/GAMES_ADMIN có thể chọn **Sửa kết quả** trong thẻ **Kết quả từ bảng điểm**:

Với phương thức **Thắng điểm**, ô người thắng tự cập nhật theo điểm, lợi thế, rồi số lần phạt ít hơn. API chặn người thắng không khớp các chỉ số này. Nếu hòa hoàn toàn hoặc cần quyết định riêng, chọn **Quyết định trọng tài** và chọn người thắng. Bản xem trước hiển thị cả tỷ số và người thắng trước khi lưu.

1. Sửa điểm, lợi thế, phạt, người thắng và phương thức thắng; nhập lý do hiệu chỉnh.
2. Chọn **Tính lại cặp đấu** để xem bảng cặp đấu hiện tại và sau hiệu chỉnh. Bước này chạy cùng logic cập nhật nhánh thắng/thua rồi rollback, không lưu kết quả, cặp đấu hoặc lịch sử.
3. Chọn **Lưu kết quả & cập nhật cặp đấu** để áp dụng cùng một transaction. Mã trận, sơ đồ và giờ thi đấu được giữ. Thay đổi bất kỳ trường nào sẽ làm bản xem trước hết hiệu lực; phải tính lại trước khi lưu.
4. Chọn **Trọng tài xác nhận lại kết quả đã lưu**. Hiệu chỉnh đưa kết quả về trạng thái ENTERED; phê duyệt/công bố tiếp tục theo quy trình ở trang Điều hành.

Kết quả APPROVED/PUBLISHED/LOCKED cần ADMIN **Mở lại để hiệu chỉnh** trước. Sửa người thắng bị chặn nếu phải thay VĐV ở một trận đã bắt đầu hoặc đã có kết quả; thông báo chỉ rõ trận đang cản cập nhật. Lượt miễn đấu tự động được tính lại theo nhánh, nhưng vẫn bị chặn nếu đi tới trận đã đấu. Nếu chỉ sửa điểm/phương thức và giữ nguyên người thắng, cặp đấu không thay đổi và có thể lưu cả khi trận sau đã bắt đầu.

Bản xem trước gắn với phiên bản kết quả và trạng thái các nhánh liên quan. Khi chúng thay đổi, backend yêu cầu tính lại thay vì ghi đè. Các thao tác bảng điểm cũ được giữ trong lịch sử; kết quả đã hiệu chỉnh trở thành dữ liệu hiển thị trên bảng điểm chỉ xem. Lý do và phiên bản trước/sau được ghi vào ResultRevision và hiển thị trong lịch sử hiệu chỉnh. Submission của bảng điểm vẫn yêu cầu người thắng có 50 điểm. Không cần migration cho chức năng này.

## Penalty indicators

Penalties automatically award the opponent the following benefits, identically for both sides:

| Penalty | Opponent benefit |
| --- | --- |
| 1P | No additional advantage or points |
| 2P | One additional advantage |
| 3P | Two additional points; the advantage from 2P remains |
| 4P | Win by disqualification; the opponent's score box displays 50 |

Existing points and advantages are preserved. The 50 is a display marker, so earned points remain available when undoing 4P. The clock stops at 4P and the winner/method are selected for the existing explicit result confirmation. Undo reverses the latest penalty and its automatic opponent award together; history records both effects. Reloading restores the saved counts and effects. Penalties recorded before this change are not retroactively awarded benefits, and undoing them does not remove benefits that were never awarded.

## Permissions and synchronization

`ADMIN` (Quản trị hệ thống) and `GAMES_ADMIN` (Quản lý sự kiện) can operate the board. Finishing a bout saves `REFEREE_CONFIRMED`. Both roles can approve, publish and lock results; only ADMIN can reopen results. Public scores remain hidden until publication.

The board polls every two seconds; schedule/bracket screens refresh every five seconds. Server version checks reject stale commands rather than overwrite another operator. Every command records the actor and a result revision. State is stored in `Match.resultData.scoreboard`; no database migration is required.

## Verification

```bash
npm run build
npm run lint --workspace=@sportdata/frontend
node --test apps/backend/scripts/scoreboard-penalties.test.cjs
node --test apps/frontend/tests/scoreboard-result.test.cjs
node --test apps/frontend/tests/scoreboard-controls.test.cjs
node --test apps/frontend/tests/scoreboard-timer-display.test.cjs
node tests/regression/result-correction.mjs
node tests/regression/result-correction-database.mjs
node apps/backend/scripts/smoke-scoreboard.mjs
```

The penalty tests use the real scoreboard service with in-memory transaction fixtures and require no database. They cover both sides, automatic awards, undo/replay, reload, invalid levels, stale commands, legacy actions, and disqualification confirmation.

The smoke test requires the development database and at least one country. It starts an isolated HTTP server, creates separate fixtures, checks authorization, clock persistence, scoring/undo, concurrent writes, scheduling/rest gates, winner/loser progression and transaction rollback, then deletes its fixtures. It does not alter existing competition matches.


For the design regression check, use Playwright with the running frontend and the supplied HTML reference. The API is mocked and no competition records are modified:

```bash
SCOREBOARD_PLAYWRIGHT_MODULE=/tmp/sportdata-ui-check/node_modules/playwright \
SCOREBOARD_CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
node tests/regression/scoreboard-design-ui.mjs
```

If using Playwright's installed Chromium, omit `SCOREBOARD_CHROME_PATH`. The check verifies row/footer geometry, colors and Arial at four viewport sizes, mat/category/weight/round data, federation priority and country fallback, and read-only keyboard/lease behavior. A screenshot is written to `/tmp/sportdata-scoreboard-new-design.png`.
