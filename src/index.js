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
const revenue = require('./workers/revenue');
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
  '/doanhthu — doanh thu hôm qua (đơn đã cọc trở đi, từ Sheet đơn hàng; /doanhthu 16/10/2026 để xem ngày khác)',
  '/id — xem ID của bạn và ID nhóm',
  '',
  '🧠 <b>Các bộ não AI:</b>',
  '/gpt &lt;việc&gt; — 🌸💋 Yua Mikami (GPT): viết caption, bài đăng, dịch',
  '/claude &lt;việc&gt; — 😏🔥 Eimi Fukada (Claude): phân tích, tư vấn, kế hoạch',
  '/grok &lt;việc&gt; — 👑💋 Yui Hatano (Grok): tra cứu, hỏi đáp',
  '/deepseek &lt;việc&gt; — 💙🌊 Sora Aoi (DeepSeek): suy luận, tính toán, code',
  '/gemini &lt;việc&gt; — ✨🌙 Tsukasa Aoi (Gemini): việc chung',
  '<i>Lệnh tắt theo tên: /yua · /eimi · /yui · /sora · /tsukasa (dùng thay cho các lệnh trên)</i>',
  '/hoi3nao &lt;câu hỏi&gt; — hỏi tất cả các bộ não để so sánh',
  '/nao — trạng thái + lượt dùng hôm nay của các bộ não',
  '/phanviec — bảng phân việc: nàng nào phụ trách mảng nào',
  '',
  '<i>Nhắn tự do cũng được: "tỷ giá", "3kg bay", "lead 09xxxx tên khách"...</i>',
  '<i>Hoặc giao 1 việc bất kỳ (vd "viết caption bán giày Nhật") → Bot Tổng tự chọn bộ não phù hợp.</i>',
].join('\n');

function brainLabel(id) {
  const b = brains.BRAINS[id];
  const L = brains.label(id);
  return `${L.icon} ${L.name} (${b.brand}):`;
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

async function replyBrain(chatId, brainId, prompt, replyTo) {
  const b = brains.BRAINS[brainId];
  const L = brains.label(brainId);
  if (!brains.hasKey(brainId)) {
    return tg.sendMessage(chatId, `⚠️ ${L.icon} ${L.name} (${b.brand}) chưa có API key. Thêm biến <code>${b.keyEnv}</code> trên Render để kích hoạt.`);
  }
  await tg.sendTyping(chatId, brains.botToken(brainId) || undefined);
  const r = await brains.ask(brainId, prompt);
  if (r.ok) return deliverBrainReply(chatId, brainId, r.text, replyTo);
  const detail = r.message ? ` (${String(r.message).slice(0, 200)})` : '';
  return tg.sendMessage(chatId, `❌ ${L.name} ${BRAIN_REASONS[r.reason] || r.reason}${detail}. Anh thử bộ não khác, hoặc nhắn việc tự do để Bot Tổng tự chọn não dự phòng.`);
}

// Gửi câu trả lời của 1 bộ não: ưu tiên bằng TÀI KHOẢN BOT RIÊNG của chính nó (tên + avatar riêng trong nhóm);
// chưa có bot riêng, hoặc gửi lỗi (chưa được thêm vào nhóm), thì Bot Tổng gửi thay kèm nhãn tên.
async function deliverBrainReply(chatId, brainId, text, replyTo, note = '') {
  const token = brains.botToken(brainId);
  if (token) {
    const sent = await tg.sendPlain(chatId, text, token, replyTo);
    if (sent && sent.ok) return sent;
    console.error(`Bot riêng của ${brainId} gửi lỗi — chuyển qua Bot Tổng`);
  }
  return tg.sendPlain(chatId, `${brainLabel(brainId)}${note}\n${text}`, undefined, replyTo);
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
    if (text.startsWith('/doanhthu')) {
      if (!revenue.configured()) {
        return tg.sendMessage(chatId, '⚠️ Chưa nối Sheet doanh thu (thiếu REVENUE_SHEET_ID trên Render).');
      }
      await tg.sendTyping(chatId);
      const arg = text.slice('/doanhthu'.length).trim();
      try {
        const m = arg.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (m) {
          const ds = `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}`;
          return tg.sendMessage(chatId, await revenue.reportFor(ds));
        }
        if (arg === 'homnay' || arg === 'hôm nay') {
          return tg.sendMessage(chatId, await revenue.reportFor(revenue.todayStr()));
        }
        return tg.sendMessage(chatId, await revenue.reportYesterday());
      } catch (e) {
        console.error('Lỗi /doanhthu:', e.message);
        return tg.sendMessage(chatId, '⚠️ Không đọc được Sheet doanh thu. Kiểm tra REVENUE_SHEET_ID và quyền chia sẻ file cho tài khoản bot.');
      }
    }

    // --- Giai đoạn 2: các bộ não AI (có lệnh tắt theo tên riêng) ---
    const BRAIN_ALIASES = { yua: 'gpt', eimi: 'claude', yui: 'grok', sora: 'deepseek', tsukasa: 'gemini' };
    const brainCmd = text.match(/^\/(gpt|claude|grok|gemini|deepseek|yua|eimi|yui|sora|tsukasa)\s+([\s\S]+)$/);
    if (brainCmd) {
      const target = BRAIN_ALIASES[brainCmd[1]] || brainCmd[1];
      return replyBrain(chatId, target, brainCmd[2].trim(), msg.message_id);
    }
    if (/^\/(gpt|claude|grok|gemini|deepseek|yua|eimi|yui|sora|tsukasa)$/.test(text)) {
      return tg.sendMessage(chatId, `Ví dụ đúng: ${text} viết caption bán áo khoác Nhật`);
    }
    if (text.startsWith('/hoi3nao')) {
      const prompt = text.replace('/hoi3nao', '').trim();
      if (!prompt) return tg.sendMessage(chatId, 'Ví dụ đúng: /hoi3nao nên chạy quảng cáo đấu giá hay mua hộ?');
      if (!brains.ORDER.some((id) => brains.hasKey(id))) {
        return tg.sendMessage(chatId, '⚠️ Chưa có bộ não nào có API key. Thêm key trên Render trước nhé.');
      }
      await tg.sendTyping(chatId);
      // Phát trực tiếp: nàng nào trả lời xong trước thì lên tiếng trước — 1 nàng chậm/lỗi không làm cả đội im lặng
      const jobs = brains.ORDER.filter((id) => brains.hasKey(id)).map(async (id) => {
        const r = await brains.ask(id, prompt);
        if (r.ok) await deliverBrainReply(chatId, id, r.text, msg.message_id);
        else await tg.sendMessage(chatId, `❌ ${brains.label(id).name} không trả lời được (${BRAIN_REASONS[r.reason] || r.reason}${r.message ? ' — ' + String(r.message).slice(0, 200) : ''}).`);
      });
      await Promise.allSettled(jobs);
      return;
    }
    if (text.startsWith('/phanviec') || text.startsWith('/viec')) {
      const lines = [
        '📋 <b>Bảng phân việc — đội trợ lý AI HikariGo:</b>',
        '',
        '🌸💋 <b>Yua Mikami</b> (GPT) — <b>Thợ Chữ</b>: nội dung & chăm khách — viết caption, bài đăng, tin nhắn mẫu, dịch Nhật↔Việt, slogan. → /yua',
        '😏🔥 <b>Eimi Fukada</b> (Claude) — <b>Tham Mưu</b>: phân tích & tư vấn quyết định — xử lý khiếu nại, chiến lược, kế hoạch, soi rủi ro. → /eimi',
        '👑💋 <b>Yui Hatano</b> (Grok) — <b>Thám Tử</b>: tra cứu & kiểm chứng — tin tức, thông tin, giá thị trường. → /yui',
        '💙🌊 <b>Sora Aoi</b> (DeepSeek) — <b>Thợ Tính</b>: tính toán & số liệu — tính cước, quy đổi yên→VND, tính giá đơn, code. → /sora',
        '✨🌙 <b>Tsukasa Aoi</b> (Gemini) — <b>Học Việc đa năng</b>: tóm tắt, việc thường ngày, dự phòng khi đồng đội bận/hết lượt. → /tsukasa',
        '',
        '<i>Nhắn việc tự do → Bot Tổng tự giao cho đúng nàng theo bảng này. Muốn chỉ định thẳng thì dùng lệnh tắt của nàng đó.</i>',
      ];
      return tg.sendMessage(chatId, lines.join('\n'));
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
        lines.push(`${s.icon} <b>${s.name}</b> (${s.brand} · ${s.model}) — ${st} — đã dùng ${s.used}/${s.cap}${s.hasBot ? ' · 🏠 có bot riêng' : ''}`);
      }
      lines.push('', '<i>Đổi model: sửa biến OPENAI_MODEL / ANTHROPIC_MODEL / XAI_MODEL / DEEPSEEK_MODEL / GEMINI_MODEL trên Render.</i>');
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
        const note = r.fellBack ? ' (não chính bận — đã chuyển dự phòng)' : '';
        return deliverBrainReply(chatId, r.brainId, r.text, msg.message_id, note);
      }
      return tg.sendMessage(chatId, `❌ Tất cả các bộ não đều không trả lời được lúc này. Chi tiết: ${r.notes.join(' · ') || 'chưa có não nào có key'}. Gõ /nao để xem trạng thái.`);
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

// Báo cáo doanh thu ngày hôm trước — 8:00 sáng giờ VN, vào nhóm điều hành
if (GROUP_CHAT_ID && revenue.configured()) {
  cron.schedule(
    '0 8 * * *',
    async () => {
      try {
        await tg.sendMessage(GROUP_CHAT_ID, await revenue.reportYesterday());
        console.log('Đã gửi báo cáo doanh thu 8:00');
      } catch (e) {
        console.error('Lỗi báo cáo doanh thu 8:00:', e);
      }
    },
    { timezone: 'Asia/Saigon' }
  );
}

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
    // Đăng ký webhook + menu lệnh: mạng tới Telegram chập chờn lúc khởi động thì thử lại, không để sập deploy
    for (let attempt = 1; attempt <= 3; attempt++) {
      const r = await tg.setWebhook(url);
      console.log(`Đặt webhook (lần ${attempt}):`, r.ok ? 'OK' : r.description);
      if (r.ok) {
        const c = await tg.setCommands();
        console.log('Đăng ký menu lệnh:', c.ok ? 'OK' : c.description);
        break;
      }
      if (attempt < 3) await new Promise((res) => setTimeout(res, 5000));
    }
  } else {
    console.log('Chưa có RENDER_EXTERNAL_URL/BOT_TOKEN — bỏ qua đặt webhook.');
  }
});
