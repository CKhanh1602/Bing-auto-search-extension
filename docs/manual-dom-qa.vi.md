# Kiểm tra Auto Quest trên Edge — bản 2.0.1

Scanner hiện tại: **official-cards-v17**. Lịch sử sửa và bằng chứng test nằm trong
[auto-quest-fix.md](auto-quest-fix.md); tài liệu này mô tả bản đang phát hành.

## Cài và quan sát

1. Mở `edge://extensions`, bật **Developer mode**, chọn **Load unpacked** và
   chọn thư mục project hoặc thư mục đã giải nén ZIP chứa `manifest.json`.
   Nếu đã cài đúng thư mục, bấm **Reload**, đóng popup cũ rồi mở lại.
2. Kiểm tra version **2.0.1** và không có lỗi load. Mở inspector của service worker
   để xem log; khi test worker tự ngừng, đóng inspector để nó không giữ worker sống.
3. Tự đăng nhập Microsoft Rewards trên trình duyệt. Kiểm tra Daily set và Earn
   đang hiện thẻ, sau đó mở popup và chọn **Nhiệm vụ / Quests**.
4. Log phải có `Quest scanner: official-cards-v17`. Đối chiếu số xác nhận trong
   popup với dấu **Completed** trên Rewards, không chỉ với số tab được mở.
5. Popup có nội dung rộng 420px. Thử đổi ngôn ngữ, theme, mở cài đặt và cuộn xuống.
   Popup toolbar đóng khi mất focus theo hành vi của Edge; mở lại để xem trạng thái.
   Đóng popup không dừng run; dùng **Stop / Dừng** để dừng.
6. **Quest wait limit** mặc định 10 giây, chỉnh được 10–300 giây khi mạng yếu.
   Giá trị đã lưu được giữ lại. Đây là giới hạn cho từng pha tải/xác nhận, không
   phải sleep cố định: đủ dữ liệu thì chạy tiếp ngay.

## Cách Quest hoạt động

Extension đọc dữ liệu Rewards và chờ thẻ thật trên flyout Bing chính thức.
Nó kích hoạt một lần thẻ Daily set hoặc Earn đang chờ và có điểm, kể cả thẻ mang
nhãn quiz/poll. Nó không trả lời quiz hoặc thao tác tiếp ở trang đích.
Thẻ đã hoàn thành, ẩn/test, không có điểm, có ngày cũ/tương lai hoặc URL không được
phép bị bỏ qua. Metadata được đọc lại trước mỗi thẻ và DOM phải khớp duy nhất.
Chỉ tăng tiến độ sau hai lần liên tiếp server xác nhận hoàn thành.

Thẻ không có trên flyout, điều khiển không được hỗ trợ hoặc chưa nhận xác nhận
được để lại cho bạn kiểm tra, không tự coi là hoàn thành. Thông báo số quest còn
lại là kết quả của run vừa xong; nó không theo dõi tiếp thao tác thủ công.

## Kiểm tra không làm lại và lifecycle

- Sau khi run hoàn thành, ghi lại các thẻ **Completed**. Bấm Nhiệm vụ lần nữa
  trong cùng ngày: thẻ đã xong không được kích hoạt lại. Nếu hết thẻ hợp lệ thì
  không có tab nhiệm vụ mới. Ngày mới được quét bằng trạng thái hiện tại, không
  dùng blacklist ID vĩnh viễn có thể bỏ sót quest mới.
- **Pause / Tạm dừng** chặn thao tác tiếp và giữ thời hạn; **Resume / Tiếp tục**
  đi tiếp mà không bấm lại thẻ đã xác nhận. Đóng/mở popup vẫn hiện trạng thái đó.
- Bấm **Stop** khi đang tải hoặc đang Pause: nút phải được mở khóa ngay. Start run
  mới; phản hồi muộn của run cũ không được đổi trạng thái hoặc mở/đóng tab mới.
  Thao tác website đã được gửi trước Stop không thể thu hồi.
- Reload extension giữa run rồi mở popup: phải báo gián đoạn/dừng rõ ràng, không
  tự chạy lại. Start lại sẽ quét trạng thái server hiện tại trước khi thao tác.
  Thử dừng worker khi inspector đã đóng và kiểm tra tương tự.
- Thử mạng Offline/Slow, đóng tab quest sớm hoặc dùng thẻ không khớp selector:
  phải có lỗi rõ ràng/quest chưa xác nhận, không tăng điểm giả và không bị kẹt.
  Lỗi 429 phải dừng, không retry tự động. Khôi phục mạng sau kiểm tra.
- Thử Search và Run all với cấu hình của bạn: Search giữ đúng số lượng/delay;
  Run all tiếp tục Search sau handoff, nhưng không tiếp tục sau Stop.

## Thông tin gửi khi gặp lỗi

Gửi version, mã scanner, mã lỗi và chuỗi thao tác Start/Pause/Stop; ghi rõ thẻ thuộc
Daily set hay Earn và có dấu Completed hay chưa. Có thể copy `outerHTML` của một
thẻ và header section bằng DevTools Elements. Chỉ gửi phần cần thiết, xóa tên tài
khoản, email, số dư, token/cookie và tham số URL cá nhân trước khi gửi.

Mã thường gặp: `QUEST_SIGN_IN_REQUIRED`, `QUEST_API_NETWORK`, `QUEST_API_SCHEMA`,
`QUEST_CARD_NOT_READY`, `QUEST_CARD_AMBIGUOUS`, `TAB_CLOSED`, `QUEST_RATE_LIMITED`.
Tăng giới hạn chờ chỉ hữu ích khi dữ liệu còn đang tải; thẻ đã biến mất/đổi cấu trúc
cần đối chiếu DOM và API. Test fixture chứng minh logic extension, còn tài khoản
thật và worker tự ngừng do idle cần kiểm tra trực tiếp trên trình duyệt của bạn.
