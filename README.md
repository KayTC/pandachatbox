# Panda Chat Box

Giao diện chat AI tên **Panda Chat Box**, dùng API chuẩn OpenAI-compatible (link + key của đơn vị cung cấp).

## Tính năng

- Trả lời dạng streaming (chữ hiện dần), có nút dừng
- Markdown đầy đủ: tiêu đề, danh sách, bảng, trích dẫn
- Khối code tô màu cú pháp + nút sao chép nhanh
- Nhiều cuộc trò chuyện, lưu tự động trong trình duyệt (localStorage)
- Giao diện tối giản hiện đại với bong bóng kính kiểu iOS 26, sáng/tối, responsive dùng tốt trên điện thoại
- Nền chuyển động aurora + lưới công nghệ + quầng sáng AI, tự giảm chuyển động nếu người dùng bật reduced motion
- Hiệu ứng vệt panda nhỏ dần mờ dần theo con trỏ (chỉ trên thiết bị dùng chuột)
- Không hiển thị tên model ra giao diện
- Sao chép tin nhắn, tạo lại câu trả lời
- Đính kèm ảnh bằng nút kẹp giấy, dán trực tiếp từ clipboard, hoặc kéo thả vào ô nhập
- Đọc tài liệu PDF, DOCX, XLSX/XLS, CSV, PPTX, TXT, MD, JSON... và gửi nội dung cho AI
- API key được giữ ở server, không lộ ra trình duyệt
- System prompt/skill đặt trong `prompts/system.md`, tự nạp lại khi sửa

## Chạy dự án

Yêu cầu: Node.js 20.16 trở lên (khuyến nghị Node 22).

```bash
npm install
cp .env.example .env   # nếu chưa có file .env
npm start
```

Mở http://localhost:3000

Chế độ tự khởi động lại khi sửa code:

```bash
npm run dev
```

## Cấu hình

Mở file `.env` và điền thông tin do đơn vị cung cấp:

```ini
AI_BASE_URL=https://api.nha-cung-cap.com/v1
AI_API_KEY=key-cua-ban
AI_MODEL=ten-model
```

- `AI_BASE_URL`: link API gốc, thường kết thúc bằng `/v1`. Nếu link đã là `.../chat/completions` thì dùng nguyên link đó.
- `AI_API_KEY`: key bí mật. Không chia sẻ file này.
- `AI_MODEL`: tên model muốn dùng (hỏi đơn vị cung cấp nếu chưa rõ).
- `AI_SYSTEM_PROMPT`: (tùy chọn) ghi đè system prompt. Mặc định dùng `prompts/system.md`.
- `AI_EXTRA_HEADERS`: (tùy chọn) header bổ sung dạng JSON nếu nhà cung cấp yêu cầu.
- `AI_EXTRA_BODY`: (tùy chọn) tham số bổ sung gửi kèm request dạng JSON, ví dụ `{"max_tokens":1024}`.
- `PORT`: cổng chạy server, mặc định `3000`.
- `HOST`: mặc định `127.0.0.1` (chỉ trong máy). Đổi thành `0.0.0.0` nếu muốn truy cập từ thiết bị khác trong LAN — khi đó nên đặt sau reverse proxy có xác thực.

## Độ trễ

Tốc độ trả lời phụ thuộc chủ yếu vào model của nhà cung cấp. Đo thực tế với cùng một câu hỏi:

| Model | Thời gian tới chữ đầu tiên |
| --- | --- |
| `deepseek-v4.1-flash-req` | ~2,1 giây |
| `grok-4.6` | ~2,5 giây |
| `gemini-3.8-flash` | ~15 giây |

Server proxy của Panda chỉ thêm vài chục mili giây. Nếu thấy chậm, đổi `AI_MODEL` sang model nhanh hơn.

Sau khi lưu `.env`, server tự động nạp lại cấu hình (không cần khởi động lại). Thanh trạng thái ở sidebar sẽ báo **Đã kết nối** khi cấu hình hợp lệ.

## Skill và quy tắc trả lời

Toàn bộ quy tắc nằm trong `prompts/system.md`: giọng văn tự nhiên như người viết, độ chính xác dữ kiện, cách xử lý khi thiếu thông tin, giữ mạch ngữ cảnh, tiết kiệm token và cách đọc tệp đính kèm. Sửa file này rồi lưu, server tự nạp lại.

Nếu muốn ghi đè nhanh, đặt `AI_SYSTEM_PROMPT` trong `.env` (khi có giá trị, nó được ưu tiên hơn file).

## Tệp đính kèm

- Ảnh: PNG, JPG, WEBP, GIF — ảnh lớn được thu nhỏ/tối ưu ở trình duyệt trước khi gửi, tối đa 8MB mỗi ảnh.
- Tài liệu: PDF, DOCX/DOCM, XLSX/XLSM/XLS, CSV, PPTX/PPTM, ODT/ODS/ODP, TXT, MD, JSON, HTML, XML, YAML... tối đa 25MB mỗi tệp.
- Mỗi tin nhắn tối đa 6 tệp. Nội dung tài liệu được trích xuất ở server, giữ trong bộ nhớ và không ghi ra đĩa.
- PDF dạng scan (ảnh) không trích xuất được chữ; hãy gửi ảnh trang đó để AI đọc bằng thị giác.
- Nếu tệp báo lỗi trích xuất, xem log của server (terminal đang chạy `npm start`) để biết tên tệp và lý do cụ thể.
- Nội dung tệp được rút gọn khi quá dài; phần cũ trong lịch sử có thể được lược bớt để tiết kiệm context, phần gần nhất luôn được giữ đầy đủ.

## Cấu trúc

```
server.js           # Express server, proxy streaming, trích xuất tệp
prompts/system.md   # Skill/quy tắc trả lời
public/index.html   # Giao diện
public/styles.css   # Theme sáng/tối, responsive
public/app.js       # Logic chat, markdown, tệp đính kèm, lịch sử
.env                # Thông tin nhà cung cấp (không commit)
```

## Đăng nhập và đồng bộ lịch sử

Chỉ có đăng nhập, **không có chức năng tạo tài khoản**. Tài khoản cố định:

| Tài khoản | Mật khẩu |
| --- | --- |
| `admin` | `admin123` |
| `panda` | `140905` |

Đổi danh sách tài khoản bằng biến môi trường `AUTH_USERS` (JSON), ví dụ:

```ini
AUTH_USERS=[{"username":"admin","password":"matkhau-moi","name":"Admin"},{"username":"panda","password":"matkhau-khac","name":"Panda"}]
```

Nếu không đặt, hệ thống dùng 2 tài khoản mặc định ở trên. Mật khẩu được băm bằng scrypt trong bộ nhớ, không lưu plaintext.

Lịch sử chat lưu dạng key-value, không cần database:

- **Local (mặc định)**: file `data/store.json`, phù hợp chạy trên máy.
- **Online miễn phí**: Upstash Redis REST (free 10.000 lệnh/ngày, 256MB). Tạo Redis tại https://console.upstash.com rồi đặt `UPSTASH_REDIS_REST_URL` và `UPSTASH_REDIS_REST_TOKEN`.

Khách chưa đăng nhập:

- Được hỏi **3 câu miễn phí** (đổi bằng `GUEST_QUESTION_LIMIT`)
- Thanh đếm hiện ngay trên ô nhập: "Còn 2/3 câu hỏi miễn phí"
- Hết lượt: ô nhập khóa, nút gửi tắt, tự mở hộp đăng nhập; nếu cố nhấn Enter cũng mở hộp đăng nhập chứ không gửi
- Bộ đếm lưu phía server theo cookie + IP (IP tối đa 20 câu/24h để tránh xóa cookie lách luật)
- Đăng nhập xong dùng không giới hạn, thanh đếm tự ẩn
- Đặt `REQUIRE_LOGIN=true` nếu muốn bỏ hoàn toàn quyền hỏi miễn phí

Hoạt động:

- Đăng nhập bằng tên tài khoản + mật khẩu; session 30 ngày; rate-limit 20 lần/10 phút
- Lịch sử được tách riêng theo từng tài khoản (đăng xuất sẽ ẩn lịch sử của tài khoản đó)
- Chat xong tự đẩy lên cloud (debounce ~1 giây), mở máy khác đăng nhập cùng tài khoản là thấy lịch sử
- Đồng bộ chống ghi đè bản cũ; nếu dữ liệu quá lớn, app tự bỏ ảnh base64 khi đẩy lên (ảnh gốc vẫn còn trên máy đã tạo)
- Đặt `REQUIRE_LOGIN=true` để bắt buộc đăng nhập mới chat được

Giới hạn: 300 hội thoại/tài khoản, 8MB dữ liệu đồng bộ/tài khoản.

Lưu ý: trên gói free của Render ổ đĩa là tạm thời, nên nếu **không** cấu hình Upstash thì lịch sử trên server sẽ mất sau mỗi lần deploy/restart. Lịch sử trong trình duyệt vẫn còn.

## Deploy lên Render

Cách nhanh nhất: dùng file `render.yaml` có sẵn (Blueprint).

1. Push code lên GitHub (không commit `.env`).
2. Render → **New** → **Blueprint** → chọn repo. Render đọc `render.yaml`.
3. Trong tab **Environment**, nhập `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`.
4. Deploy. Kiểm tra `https://<tên-app>.onrender.com/healthz` trả `{"ok":true}`.

Hoặc tạo **Web Service** thủ công:

- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/healthz`
- Node version: lấy từ `.nvmrc` (22), hoặc đặt biến `NODE_VERSION=22`

Lưu ý khi chạy trên Render:

- Không cần đặt `PORT` hay `HOST`; Render tự cấp `PORT` và server bind `0.0.0.0` khi phát hiện môi trường cloud/production.
- Biến môi trường đặt trong dashboard Render, **không** dùng file `.env`.
- Gói Free sẽ "ngủ" sau ~15 phút không truy cập; request đầu tiên sau đó chậm vài chục giây.
- Ổ đĩa trên Render là tạm thời: lịch sử chat lưu ở trình duyệt người dùng nên không mất, nhưng không có gì ghi trên server để giữ.
- Nếu build lỗi ở bước `npm install` với gói `xlsx` (tải từ cdn.sheetjs.com), kiểm tra Render có truy cập được host đó; hoặc đổi sang gói npm tương đương nếu cần.

## Ghi chú

- Lịch sử chat lưu trên máy người dùng, xóa bằng nút thùng rác ở sidebar.
- Thư viện hiển thị markdown (marked, highlight.js) tải từ CDN; cần Internet khi mở trang.
- Nếu dùng reverse proxy (nginx), cần tắt buffer cho endpoint `/api/chat` để streaming mượt.
- Ảnh/tệp đính kèm được lưu trong localStorage cùng lịch sử chat; dung lượng trình duyệt có hạn (khoảng 5MB), nên xóa bớt hội thoại cũ nếu thấy chậm hoặc đầy bộ nhớ.
- Không có công cụ nào đảm bảo qua được kiểm tra đạo văn/liêm chính học thuật; hãy dùng Panda để hỗ trợ diễn đạt và luôn tự kiểm chứng, ghi nguồn đầy đủ.
