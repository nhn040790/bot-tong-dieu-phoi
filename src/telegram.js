// Tiện ích gọi Telegram Bot API — hỗ trợ gửi bằng nhiều tài khoản bot (Bot Tổng + bot riêng từng bộ não)
const TOKEN = process.env.BOT_TOKEN;

async function call(method, body, token) {
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
      { command: 'gpt', description: 'Yua Mikami (GPT): viết lách, dịch' },
      { command: 'claude', description: 'Eimi Fukada (Claude): phân tích, tư vấn' },
      { command: 'grok', description: 'Yui Hatano (Grok): tra cứu, hỏi đáp' },
      { command: 'deepseek', description: 'Sora Aoi (DeepSeek): tính toán, code' },
      { command: 'gemini', description: 'Tsukasa Aoi (Gemini): việc chung' },
      { command: 'yua', description: 'Lệnh tắt → Yua Mikami (GPT)' },
      { command: 'eimi', description: 'Lệnh tắt → Eimi Fukada (Claude)' },
      { command: 'yui', description: 'Lệnh tắt → Yui Hatano (Grok)' },
      { command: 'sora', description: 'Lệnh tắt → Sora Aoi (DeepSeek)' },
      { command: 'tsukasa', description: 'Lệnh tắt → Tsukasa Aoi (Gemini)' },
      { command: 'hoi3nao', description: 'Hỏi tất cả các bộ não cùng lúc' },
      { command: 'nao', description: 'Trạng thái các bộ não' },
      { command: 'help', description: 'Danh sách lệnh đầy đủ' },
    ],
  });
}

module.exports = { sendMessage, sendTyping, sendPlain, setWebhook, setCommands };
