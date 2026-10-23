// Tiện ích gọi Telegram Bot API — hỗ trợ gửi bằng nhiều tài khoản bot (Bot Tổng + bot riêng từng bộ não)
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.BOT_TOKEN;

async function call(method, body, token) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token || TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error(`Telegram API ${method} lỗi:`, data.description);
    }
    return data;
  } catch (err) {
    // Lỗi mạng (timeout, không phân giải được...) — chỉ ghi log, TUYỆT ĐỐI không ném ra ngoài làm sập tiến trình
    console.error(`Telegram API ${method} lỗi mạng:`, err.message);
    return { ok: false, description: `network: ${err.message}` };
  }
}

function sendMessage(chatId, text, extra = {}) {
  return call('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  });
}

function sendTyping(chatId, token) {
  return call('sendChatAction', { chat_id: chatId, action: 'typing' }, token);
}

// Gửi văn bản thuần (không parse HTML — an toàn với nội dung AI trả về), tự cắt nhỏ nếu quá dài.
// token: gửi bằng tài khoản bot riêng (để trống = Bot Tổng). replyTo: id tin nhắn gốc để trả lời dính chuỗi.
async function sendPlain(chatId, text, token, replyTo) {
  const LIMIT = 3900;
  const s = String(text || '');
  let last = null;
  let rest = s;
  let first = true;
  while (rest.length > LIMIT) {
    let cut = rest.lastIndexOf('\n', LIMIT);
    if (cut < LIMIT * 0.5) cut = LIMIT;
    const body = { chat_id: chatId, text: rest.slice(0, cut), disable_web_page_preview: true };
    if (first && replyTo) body.reply_to_message_id = replyTo;
    last = await call('sendMessage', body, token);
    first = false;
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest) {
    const body = { chat_id: chatId, text: rest, disable_web_page_preview: true };
    if (first && replyTo) body.reply_to_message_id = replyTo;
    last = await call('sendMessage', body, token);
  }
  return last;
}

async function setWebhook(url) {
  return call('setWebhook', { url, drop_pending_updates: true });
}

// Đăng ký menu lệnh — gõ "/" trong Telegram sẽ hiện danh sách này để chọn, khỏi phải nhớ lệnh
async function setCommands() {
  return call('setMyCommands', {
    commands: [
      { command: 'tygia', description: 'Tỷ giá yên hôm nay (Vietcombank)' },
      { command: 'cuoc', description: 'Tính cước — vd: /cuoc 3 bay' },
      { command: 'gia', description: 'Quy đổi tiền hàng yên → VND' },
      { command: 'lead', description: 'Ghi lead vào Google Sheet' },
      { command: 'leads', description: 'Xem lead hôm nay' },
      { command: 'baocao', description: 'Báo cáo lead trong ngày' },
      { command: 'doanhthu', description: 'Doanh thu hôm qua (từ Sheet đơn hàng)' },
      { command: 'gpt', description: 'Yua Mikami (GPT): biên kịch, caption' },
      { command: 'claude', description: 'Eimi Fukada (Claude): đạo diễn, chiến lược' },
      { command: 'grok', description: 'Yui Hatano (Grok): bắt trend, tra cứu' },
      { command: 'deepseek', description: 'Sora Aoi (DeepSeek): kỹ thuật dựng' },
      { command: 'gemini', description: 'Tsukasa Aoi (Gemini): phụ đề, việc chung' },
      { command: 'yua', description: 'Lệnh tắt → Yua Mikami (GPT)' },
      { command: 'eimi', description: 'Lệnh tắt → Eimi Fukada (Claude)' },
      { command: 'yui', description: 'Lệnh tắt → Yui Hatano (Grok)' },
      { command: 'sora', description: 'Lệnh tắt → Sora Aoi (DeepSeek)' },
      { command: 'tsukasa', description: 'Lệnh tắt → Tsukasa Aoi (Gemini)' },
      { command: 'hoi3nao', description: 'Hỏi tất cả các bộ não cùng lúc' },
      { command: 'nao', description: 'Trạng thái các bộ não' },
      { command: 'phanviec', description: 'Bảng phân việc của 5 bộ não' },
      { command: 'doc', description: '🎬 Dựng: khung dọc 9:16 (gửi kèm video)' },
      { command: 'vuong', description: '🎬 Dựng: khung vuông 1:1' },
      { command: 'ngang', description: '🎬 Dựng: khung ngang 16:9' },
      { command: 'cat', description: '🎬 Dựng: cắt video — /cat 5 20' },
      { command: 'tocdo', description: '🎬 Dựng: đổi tốc độ — /tocdo 1.5' },
      { command: 'chu', description: '🎬 Dựng: chèn chữ — /chu Nội dung' },
      { command: 'anh', description: '🎬 Dựng: trích khung hình' },
      { command: 'info', description: '🎬 Dựng: thông tin video' },
      { command: 'help', description: 'Danh sách lệnh đầy đủ' },
    ],
  });
}

// Kiểm tra vai trò của 1 người trong 1 nhóm (creator/administrator/member...) — dùng để mở quyền dùng bot cho admin nhóm
async function getChatMember(chatId, userId) {
  return call('getChatMember', { chat_id: chatId, user_id: userId });
}

// Lấy thông tin file trên Telegram (đường dẫn tải) — phục vụ bot thợ Dựng video
async function getFile(fileId) {
  return call('getFile', { file_id: fileId });
}

// Tải file từ Telegram về máy (file_path lấy từ getFile)
async function downloadToFile(filePath, destPath) {
  const res = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${filePath}`);
  if (!res.ok) throw new Error(`Tải file từ Telegram lỗi HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
  return buf.length;
}

// Gửi file (video/ảnh) dạng multipart — Bot API không nhận JSON cho việc tải lên
async function sendFile(method, field, chatId, filePath, { caption, replyTo } = {}) {
  try {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (caption) {
      form.append('caption', caption);
      form.append('parse_mode', 'HTML');
    }
    if (method === 'sendVideo') form.append('supports_streaming', 'true');
    if (replyTo) form.append('reply_parameters', JSON.stringify({ message_id: replyTo }));
    form.append(field, new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, { method: 'POST', body: form });
    const data = await res.json();
    if (!data.ok) console.error(`Telegram API ${method} lỗi:`, data.description);
    return data;
  } catch (err) {
    console.error(`Telegram API ${method} lỗi mạng:`, err.message);
    return { ok: false, description: `network: ${err.message}` };
  }
}

function sendVideoFile(chatId, filePath, opts) {
  return sendFile('sendVideo', 'video', chatId, filePath, opts);
}

function sendPhotoFile(chatId, filePath, opts) {
  return sendFile('sendPhoto', 'photo', chatId, filePath, opts);
}

module.exports = { sendMessage, sendTyping, sendPlain, setWebhook, setCommands, getChatMember, getFile, downloadToFile, sendVideoFile, sendPhotoFile };
