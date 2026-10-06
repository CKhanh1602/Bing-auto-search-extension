# Chuẩn bị đưa bản 2.1.0 lên GitHub

Repo nguồn gồm code, test, fixture đã làm sạch, script và tài liệu. Gói cài đặt
extension là ZIP riêng trong `dist/`. Không tải cả thư mục làm việc lên bằng kéo
thả: thao tác đó không áp dụng `.gitignore` và có thể lấy cả dữ liệu QA cục bộ.

## Kiểm tra và tạo gói

Yêu cầu Node 22 trở lên. Project không có dependency runtime, bundler, TypeScript
hoặc cấu hình ESLint; không cần `npm install`.

```sh
npm run check
npm test
npm run package:extension
git diff --check
```

ZIP `dist/bing-search-automator-2.1.0.zip` chỉ chứa 12 file trong
`scripts/extension-files.cjs`: manifest, worker, hai module Quest, ba file popup,
word list, ba icon và LICENSE gốc. Timestamp ZIP cố định; cùng byte nguồn tạo cùng
gói. Giải nén rồi chọn thư mục chứa `manifest.json` bằng **Load unpacked** trên Edge.

Kiểm tra trình duyệt tùy chọn:

```sh
node scripts/edge-smoke.cjs
node scripts/popup-layout.cjs
```

Hai script cần Playwright và Edge. Đặt `PLAYWRIGHT_MODULE` tới module Playwright
đã cài nếu Node không tìm thấy; đặt `EDGE_PATH` tới executable Edge nếu khác đường
dẫn Windows mặc định. Chúng dùng profile riêng và fixture, không chứng minh tài
khoản thật nhận điểm. Hướng dẫn kiểm tra tài khoản thật nằm trong
[manual-dom-qa.vi.md](manual-dom-qa.vi.md).

## Chọn nội dung commit

`.qa/`, `dist/`, profile thử nghiệm, thư mục công cụ agent, `.env`, `.env.*`
(trừ `.env.example`), log và file đóng gói được ignore. Giữ chúng cục bộ;
không thêm bằng `git add -f`.
Các module Quest, test, script, workflow và tài liệu mới phải có trong commit.
Việc xóa test Quest cũ cũng phải được ghi nhận cùng bộ test thay thế.

Branch cập nhật là `codex/fix-auto-quest`. Khi tự đưa các thay đổi tiếp theo lên
GitHub, xem diff và xác nhận remote đúng repo của mình trước khi chạy:

```sh
git status --short
git add -A
git diff --cached --stat
git diff --cached --check
git commit -m "chore(release): prepare version 2.1.0"
git push -u origin HEAD
```

Push tạo/cập nhật branch hiện tại, không thay thế branch mặc định. Sau khi review
và merge, có thể tạo release `v2.1.0` và đính kèm ZIP; không đính kèm profile QA.

## CI và bằng chứng kiểm tra

Bản chính thức 2.1.0 giữ hành vi `auto-only-v19` đã kiểm tra ở bản chuẩn bị 2.0.4.
Manifest, package, hướng dẫn cài đặt và tên ZIP đều dùng 2.1.0. Xem
[ghi chú thay đổi](../CHANGELOG.md).

Bản 2.0.4 / `auto-only-v19` bỏ handoff manual. Thẻ đã hoàn thành không bấm lại;
thẻ thiếu/chưa xác nhận được bỏ qua, loại khỏi tổng task và không chặn Search
sau lượt Quest. Dữ liệu mâu thuẫn không được tính là điểm. Bằng chứng bản trước
bên dưới được giữ để đối chiếu lịch sử; xem [TDD hiện tại](auto-only-pass.tdd.md).
143/143 test, syntax/asset check, Edge fixture, sáu popup native và ZIP đã giải
nén/load unpacked đều qua. Không có lỗi JavaScript popup trong các kịch bản đó.

Bản 2.0.3 / scanner `daily-keep-v18` ngày 2026-10-06: 139/139 test và
syntax/asset check qua. Bộ lọc giữ Daily set và Keep earning, bỏ Quests nhiều
bước/mục tiêu đang tiến hành cùng task con trước khi tính tổng. Edge fixture
hoàn tất hai thẻ thuộc phạm vi rồi Search, không mở tab hoặc handoff cho các mục
bị loại. Xem [scope evidence](daily-keep-scope.tdd.md).

Bản 2.0.2 kiểm tra ngày 2026-10-05: 132/132 test, syntax/asset check và sáu kịch
bản popup native đều qua. Edge fixture xác nhận Auto All chỉ Search sau khi Quest
được xác nhận hoàn thành; pending, Pause và Stop đều chặn bước Search. Tiến độ
Quest và thông báo chưa Search được giữ khi mở lại popup. Xem
[TDD evidence](auto-all-order.tdd.md). Bằng chứng bản trước được giữ bên dưới.

`.github/workflows/checks.yml` chạy syntax/asset check, toàn bộ test và packaging
trên Node 22/24. Workflow có quyền đọc repository và pin action tới commit của
[checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1) và
[setup-node v7.0.0](https://github.com/actions/setup-node/releases/tag/v7.0.0).
CI đã được chuẩn bị; phải push lên GitHub mới có kết quả chạy hosted.

Kiểm tra cục bộ ngày 2026-10-04: 126/126 test qua; Edge xác nhận chạy lại sau khi
hoàn thành không mở tab hay kích hoạt thẻ cũ; năm kịch bản popup native qua;
syntax/manifest/package checks qua. Review không phát hiện mẫu credential rõ ràng
trong các file dự định công bố; dữ liệu QA riêng bị loại khỏi nội dung phát hành.
ZIP đã được kiểm tra CRC/nội dung bằng thư viện độc lập và load unpacked từ thư
mục giải nén trên Edge, gồm worker MV3, module Quest, word list và popup.
Xem [repair evidence](auto-quest-fix.md) để biết giới hạn của fixture.
