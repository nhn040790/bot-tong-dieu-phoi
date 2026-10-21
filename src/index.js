// BOT TỔNG ĐIỀU PHỐI — Giai đoạn 1
// Nhận lệnh trong nhóm Telegram → định tuyến tới bot thợ:
//   - Tra cứu: tỷ giá, tính cước, quy đổi giá hàng
//   - Dữ liệu: ghi lead vào Google Sheet, báo cáo cuối ngày
const express = require('express');
const cron = require('node-cron');
const tg = require('./telegram');
const exchange = require('./workers/exchange');
const leads = require('./workers/leads');

const PORT = process.env.PORT || 3000;
const OWNER_IDS = (process.env.OWNER_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'webhook';

const app = express();
app.use(express.json());

app.get('/', (req, res) => res.send('Bot Tong Dieu Phoi — OK'));

function isOwner(userId) {
  return OWNER_IDS.includes(String(userId));
}

const HELP = [
  '🤖 <b>Bot Tổng — danh sách lệnh:</b>',
  '/tygia — tỷ giá yên hôm nay',
  '/cuoc 3 bay — tính cước (vd: /cuoc 2.5 bien)',
  '/gia 15000 — quy đổi tiền hàng yên → VND (gồm phí mua hộ 2%)',
  '/lead 0984777000 Nguyen Van A — ghi lead vào Google Sheet',
  '/leads — lead hôm nay',
  '/baocao — báo cáo lead trong ngày',
  '/id — xem ID của bạn và ID nhóm',
  '',
  '<i>Nhắn tự do cũng được: "tỷ giá", "3kg bay", "lead 09xxxx tên khách"...</i>',
].join('\n');

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from && msg.from.id;
  const text = (msg.text || '').trim();
  if (!text) return;

  // Chế độ bootstrap: chưa cấu hình OWNER_IDS → /start trả về ID để chủ bot tự cấu hình
  if (!OWNER_IDS.length) {
    if (text.startsWith('/start') || text.startsWith('/id')) {
      await tg.sendMessage(
        chatId,
        `👋 Bot Tổng đã chạy!\nID Telegram của bạn: <code>${userId}</code>\nID nhóm này: <code>${chatId}</code>\n` +
          'Điền ID của bạn vào biến môi trường OWNER_IDS trên Render rồi redeploy để kích hoạt đầy đủ.'
      );
    }
    return;
  }

  if (!isOwner(userId)) return; // chỉ nghe lệnh của chủ bot

  const lower = text.toLowerCase();

  try {
    // --- Lệnh hệ thống ---
    if (text.startsWith('/start') || text.startsWith('/help')) {
      return tg.sendMessage(chatId, HELP);
    }
    if (text.startsWith('/id')) {
      return tg.sendMessage(chatId, `ID của bạn: <code>${userId}</code>\nID nhóm: <code>${chatId}</code>`);
    }

    // --- Bot thợ TRA CỨU ---
    if (text.startsWith('/tygia') || lower === 'tỷ giá' || lower === 'ty gia') {
      await tg.sendTyping(chatId);
      return tg.sendMessage(chatId, await exchange.traTyGia());
    }
    if (text.startsWith('/gia')) {
      const yen = parseFloat(text.replace('/gia', '').trim().replace(/[.,\s]/g, ''));
      if (!yen) return tg.sendMessage(chatId, 'Ví dụ đúng: /gia 15000');
      await tg.sendTyping(chatId);
      return tg.sendMessage(chatId, await exchange.quyDoiGia(yen));
    }
    if (text.startsWith('/cuoc')) {
      const body = lower.replace('/cuoc', '').trim();
      const m = body.match(/(\d+(?:[.,]\d+)?)/);
      if (!m) return tg.sendMessage(chatId, 'Ví dụ đúng: /cuoc 3 bay  hoặc  /cuoc 2.5 bien');
      const kg = parseFloat(m[1].replace(',', '.'));
      let loai = null;
      if (/(biển|bien|sea|tàu|tau)/.test(body)) loai = 'bien';
      else if (/(bay|air)/.test(body)) loai = 'bay';
      return tg.sendMessage(chatId, await exchange.traCuoc(kg, loai));
    }
    const cuocFree = exchange.parseCuoc(text);
    if (cuocFree && cuocFree.loai) {
      return tg.sendMessage(chatId, await exchange.traCuoc(cuocFree.kg, cuocFree.loai));
    }
    if (lower.includes('tỷ giá') || lower.includes('ty gia') || lower.includes('yen')) {
      await tg.sendTyping(chatId);
      return tg.sendMessage(chatId, await exchange.traTyGia());
    }

    // --- Bot thợ DỮ LIỆU (lead) ---
    if (text.startsWith('/lead ') || lower.startsWith('lead ')) {
      if (!leads.configured()) {
        return tg.sendMessage(chatId, '⚠️ Chưa nối Google Sheet (thiếu GOOGLE_SA_JSON / LEADS_SHEET_ID). Xem README để cấu hình.');
      }
      const body = text.replace(/^\/(lead)\s+/i, '').replace(/^lead\s+/i, '').trim();
      const phoneMatch = body.match(/(0\d{9})/);
      if (!phoneMatch) return tg.sendMessage(chatId, 'Chưa thấy SĐT hợp lệ. Ví dụ: /lead 0984777000 Nguyen Van A');
      const phone = phoneMatch[1];
      const name = body.replace(phone, '').trim();
      const r = await leads.addLead({ name, phone, source: 'Telegram (thủ công)' });
      if (r.ok) return tg.sendMessage(chatId, `✅ Đã ghi lead: <b>${name || '(chưa có tên)'}</b> — ${phone}`);
      return tg.sendMessage(chatId, '❌ Ghi lead thất bại, kiểm tra lại cấu hình Sheet.');
    }
    if (text.startsWith('/leads') || text.startsWith('/baocao')) {
      if (!leads.configured()) {
        return tg.sendMessage(chatId, '⚠️ Chưa nối Google Sheet (thiếu GOOGLE_SA_JSON / LEADS_SHEET_ID). Xem README để cấu hình.');
      }
      const rows = await leads.getLeadsToday();
      return tg.sendMessage(chatId, leads.formatLeadList(rows, '📋 <b>Lead hôm nay</b>'));
    }

    // --- Không rõ lệnh ---
    if (text.startsWith('/')) {
      return tg.sendMessage(chatId, 'Mình chưa có lệnh này. Gõ /help để xem danh sách lệnh nhé.');
    }
    // Tin nhắn tự do không khớp việc nào → bỏ qua (tránh spam nhóm). Giai đoạn 2 sẽ có AI phân loại.
  } catch (err) {
    console.error('Lỗi xử lý tin nhắn:', err);
    await tg.sendMessage(chatId, '❌ Có lỗi khi xử lý việc này, thử lại sau ít phút nhé.');
  }
}

app.post(`/${WEBHOOK_SECRET}`, async (req, res) => {
  res.sendStatus(200);
  const update = req.body;
  if (update && update.message) {
    handleMessage(update.message).catch((e) => console.error(e));
  }
});

// Báo cáo lead cuối ngày (21:00 giờ VN) vào nhóm điều hành
if (GROUP_CHAT_ID && leads.configured()) {
  cron.schedule(
    '0 21 * * *',
    async () => {
      try {
        const rows = await leads.getLeadsToday();
        await tg.sendMessage(GROUP_CHAT_ID, leads.formatLeadList(rows, '🌙 <b>Báo cáo lead cuối ngày</b>'));
      } catch (e) {
        console.error('Lỗi báo cáo cuối ngày:', e);
      }
    },
    { timezone: 'Asia/Saigon' }
  );
}

app.listen(PORT, async () => {
  console.log(`Server chạy tại cổng ${PORT}`);
  const base = process.env.RENDER_EXTERNAL_URL;
  if (base && process.env.BOT_TOKEN) {
    const url = `${base}/${WEBHOOK_SECRET}`;
    const r = await tg.setWebhook(url);
    console.log('Đặt webhook:', url, r.ok ? 'OK' : r.description);
  } else {
    console.log('Chưa có RENDER_EXTERNAL_URL/BOT_TOKEN — bỏ qua đặt webhook.');
  }
});
