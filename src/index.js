// BOT TỔNG ĐIỀU PHỐI — Giai đoạn 1 + 2
// Nhận lệnh trong nhóm Telegram → định tuyến tới bot thợ:
//   - Tra cứu: tỷ giá, tính cước, quy đổi giá hàng
//   - Dữ liệu: ghi lead vào Google Sheet, báo cáo cuối ngày
//   - Giai đoạn 2: 3 bộ não AI (GPT/Claude/Grok) + Gemini dự phòng — việc tự do, /gpt /claude /grok /hoi3nao
const express = require('express');
const cron = require('node-cron');
const tg = require('./telegram');
const exchange = require('./workers/exchange');
const leads = require('./workers/leads');
const brains = require('./brains/brains');
const router = require('./brains/router');

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
  '🧠 <b>Các bộ não AI:</b>',
  '/gpt &lt;việc&gt; — ✍️ Thợ Chữ (GPT): viết caption, bài đăng, dịch',
  '/claude &lt;việc&gt; — 🧭 Tham Mưu (Claude): phân tích, tư vấn, kế hoạch',
  '/grok &lt;việc&gt; — 🔎 Thám Tử (Grok): tra cứu, hỏi đáp',
  '/hoi3nao &lt;câu hỏi&gt; — hỏi cả 3 bộ não để so sánh',
  '/nao — trạng thái + lượt dùng hôm nay của các bộ não',
  '',
  '<i>Nhắn tự do cũng được: "tỷ giá", "3kg bay", "lead 09xxxx tên khách"...</i>',
  '<i>Hoặc giao 1 việc bất kỳ (vd "viết caption bán giày Nhật") → Bot Tổng tự chọn bộ não phù hợp.</i>',
].join('\n');

function brainLabel(id) {
  const b = brains.BRAINS[id];
  return `${b.icon} ${b.name} (${b.brand}):`;
}

const BRAIN_REASONS = {
  parked: 'đang tạm nghỉ (bị giới hạn lượt)',
  cap: 'đã hết lượt hôm nay',
  quota: 'đã hết quota/ngân sách',
  rate_limit: 'đang bị giới hạn tốc độ',
  bad_key: 'API key không hợp lệ',
  no_key: 'chưa có API key',
  error: 'gặp lỗi',
};

async function replyBrain(chatId, brainId, prompt) {
  const b = brains.BRAINS[brainId];
  if (!brains.hasKey(brainId)) {
    return tg.sendMessage(chatId, `⚠️ ${b.icon} ${b.name} (${b.brand}) chưa có API key. Thêm biến <code>${b.keyEnv}</code> trên Render để kích hoạt.`);
  }
  await tg.sendTyping(chatId);
  const r = await brains.ask(brainId, prompt);
  if (r.ok) return tg.sendPlain(chatId, `${brainLabel(brainId)}\n${r.text}`);
  return tg.sendMessage(chatId, `❌ ${b.name} ${BRAIN_REASONS[r.reason] || r.reason}. Anh thử bộ não khác, hoặc nhắn việc tự do để Bot Tổng tự chọn não dự phòng.`);
}

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

    // --- Giai đoạn 2: các bộ não AI ---
    const brainCmd = text.match(/^\/(gpt|claude|grok|gemini)\s+([\s\S]+)$/);
    if (brainCmd) {
      return replyBrain(chatId, brainCmd[1], brainCmd[2].trim());
    }
    if (/^\/(gpt|claude|grok|gemini)$/.test(text)) {
      return tg.sendMessage(chatId, `Ví dụ đúng: ${text} viết caption bán áo khoác Nhật`);
    }
    if (text.startsWith('/hoi3nao')) {
      const prompt = text.replace('/hoi3nao', '').trim();
      if (!prompt) return tg.sendMessage(chatId, 'Ví dụ đúng: /hoi3nao nên chạy quảng cáo đấu giá hay mua hộ?');
      if (!brains.ORDER.some((id) => brains.hasKey(id))) {
        return tg.sendMessage(chatId, '⚠️ Chưa có bộ não nào có API key. Thêm key trên Render trước nhé.');
      }
      await tg.sendTyping(chatId);
      const results = await router.askAll(prompt);
      for (const r of results) {
        if (r.ok) await tg.sendPlain(chatId, `${brainLabel(r.brainId)}\n${r.text}`);
        else await tg.sendMessage(chatId, `❌ ${brains.BRAINS[r.brainId].name} không trả lời được (${BRAIN_REASONS[r.reason] || r.reason}).`);
      }
      return;
    }
    if (text.startsWith('/nao')) {
      const lines = ['🧠 <b>Trạng thái các bộ não hôm nay:</b>'];
      for (const s of brains.statusList()) {
        const st = !s.hasKey
          ? '⚪ chưa có key'
          : s.available
            ? '✅ sẵn sàng'
            : s.gateReason === 'cap'
              ? '🔴 hết lượt hôm nay'
              : '⏸ tạm nghỉ';
        lines.push(`${s.icon} <b>${s.name}</b> (${s.brand} · ${s.model}) — ${st} — đã dùng ${s.used}/${s.cap}`);
      }
      lines.push('', '<i>Đổi model: sửa biến OPENAI_MODEL / ANTHROPIC_MODEL / XAI_MODEL / GEMINI_MODEL trên Render.</i>');
      return tg.sendMessage(chatId, lines.join('\n'));
    }

    // --- Việc tự do chưa khớp bot thợ nào → bộ não AI tự chọn ---
    if (!text.startsWith('/')) {
      if (!brains.ORDER.some((id) => brains.hasKey(id))) {
        return tg.sendMessage(chatId, 'Việc này cần bộ não AI mà chưa có key nào được cấu hình. Thêm OPENAI_API_KEY / ANTHROPIC_API_KEY / XAI_API_KEY / GEMINI_API_KEY trên Render nhé.');
      }
      await tg.sendTyping(chatId);
      const r = await router.askAuto(text);
      if (r.ok) {
        const label = brainLabel(r.brainId) + (r.fellBack ? ' (não chính bận — đã chuyển dự phòng)' : '');
        return tg.sendPlain(chatId, `${label}\n${r.text}`);
      }
      return tg.sendMessage(chatId, '❌ Cả 4 bộ não đều không trả lời được lúc này (hết lượt/hết quota?). Gõ /nao để xem trạng thái.');
    }

    // --- Không rõ lệnh ---
    if (text.startsWith('/')) {
      return tg.sendMessage(chatId, 'Mình chưa có lệnh này. Gõ /help để xem danh sách lệnh nhé.');
    }
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
