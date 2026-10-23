// BOT TỔNG ĐIỀU PHỐI — Giai đoạn 1 + 2
// Nhận lệnh trong nhóm Telegram → định tuyến tới bot thợ:
//   - Tra cứu: tỷ giá, tính cước, quy đổi giá hàng
//   - Dữ liệu: ghi lead vào Google Sheet, báo cáo cuối ngày
//   - Giai đoạn 2: 3 bộ não AI (GPT/Claude/Grok) + Gemini dự phòng — việc tự do, /gpt /claude /grok /hoi3nao
const express = require('express');
const cron = require('node-cron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tg = require('./telegram');
const exchange = require('./workers/exchange');
const leads = require('./workers/leads');
const revenue = require('./workers/revenue');
const video = require('./workers/video');
const brains = require('./brains/brains');
const router = require('./brains/router');

const PORT = process.env.PORT || 3000;
const OWNER_IDS = (process.env.OWNER_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID || '';
// Công tắc báo cáo tự động: đặt AUTO_REPORTS=off trên Render để TẮT TẠM báo cáo doanh thu 8:00 + lead 21:00 (bật lại: xóa biến này)
const AUTO_REPORTS = process.env.AUTO_REPORTS !== 'off';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'webhook';

const app = express();
app.use(express.json());

app.get('/', (req, res) => res.send('Bot Tong Dieu Phoi — OK'));

function isOwner(userId) {
  return OWNER_IDS.includes(String(userId));
}

// Admin của nhóm cũng được dùng bot như chủ bot (user yêu cầu 2026-10-22):
// hỏi Telegram vai trò của người gửi trong chính nhóm đó, đệm kết quả 5 phút cho đỡ tốn lượt gọi.
const adminCache = new Map(); // `${chatId}:${userId}` -> { admin, at }
async function isGroupAdmin(chatId, userId) {
  if (!chatId || chatId > 0 || !userId) return false; // chỉ áp dụng trong nhóm (chatId âm)
  const key = `${chatId}:${userId}`;
  const hit = adminCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.admin;
  let admin = false;
  const r = await tg.getChatMember(chatId, userId);
  if (r && r.ok && r.result) admin = r.result.status === 'creator' || r.result.status === 'administrator';
  adminCache.set(key, { admin, at: Date.now() });
  return admin;
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
  '/gpt &lt;việc&gt; — 🌸💋 Yua Mikami (GPT): biên kịch — kịch bản, hook, caption',
  '/claude &lt;việc&gt; — 😏🔥 Eimi Fukada (Claude): đạo diễn — chiến lược, đánh giá concept',
  '/grok &lt;việc&gt; — 👑💋 Yui Hatano (Grok): bắt trend, tra cứu',
  '/deepseek &lt;việc&gt; — 💙🌊 Sora Aoi (DeepSeek): kỹ thuật dựng, CapCut/Premiere',
  '/gemini &lt;việc&gt; — ✨🌙 Tsukasa Aoi (Gemini): phụ đề, việc chung',
  '<i>Lệnh tắt theo tên: /yua · /eimi · /yui · /sora · /tsukasa (dùng thay cho các lệnh trên)</i>',
  '/hoi3nao &lt;câu hỏi&gt; — hỏi tất cả các bộ não để so sánh',
  '/nao — trạng thái + lượt dùng hôm nay của các bộ não',
  '/phanviec — bảng phân việc: nàng nào phụ trách mảng nào',
  '',
  '🎬 <b>Dựng video</b> (gửi video kèm chú thích là lệnh, hoặc reply vào 1 video rồi gõ lệnh):',
  '/doc — khung dọc 9:16 · /vuong — vuông 1:1 · /ngang — ngang 16:9 (đệm nền mờ)',
  '/cat 5 20 — cắt từ giây 5 đến 20 · /cat 10 — lấy 10 giây đầu',
  '/tocdo 1.5 — đổi tốc độ · /chu Nội dung — chèn chữ dưới video',
  '/anh — trích khung hình · /info — thông tin video (bot tải được tối đa 20MB)',
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

// Bot thợ DỰNG VIDEO: tải file từ Telegram → ffmpeg xử lý → gửi lại vào nhóm, dọn file tạm sau khi xong
async function handleVideoCommand(chatId, msg, source, vCmd) {
  if (!video.ready()) {
    return tg.sendMessage(chatId, '⚠️ Máy dựng chưa sẵn sàng trên server (thiếu ffmpeg) — báo Muse kiểm tra bản deploy giúp em.');
  }
  if (!vCmd) return tg.sendMessage(chatId, video.VIDEO_HELP);
  if (source.fileSize && source.fileSize > video.MAX_INPUT) {
    return tg.sendMessage(chatId, `⚠️ Video nặng ${(source.fileSize / 1024 / 1024).toFixed(1)}MB — Telegram chỉ cho bot tải file tối đa 20MB. Anh gửi clip ngắn hoặc bản nén nhẹ hơn giúp em.`);
  }
  if (video.isBusy()) {
    return tg.sendMessage(chatId, '⏳ Máy dựng đang xử lý 1 video khác — anh chờ xong rồi gửi lại lệnh nhé.');
  }
  await tg.sendMessage(chatId, `🎬 Đã nhận lệnh /${vCmd.cmd} — đang dựng, video càng dài càng lâu, anh chờ em chút...`);
  let inPath = null;
  let outPath = null;
  try {
    const gf = await tg.getFile(source.fileId);
    if (!gf.ok || !gf.result) throw new Error('Không lấy được file từ Telegram.');
    inPath = path.join(os.tmpdir(), `vid_in_${Date.now()}.mp4`);
    await tg.downloadToFile(gf.result.file_path, inPath);
    const r = await video.processCommand(inPath, vCmd.cmd, vCmd.arg);
    if (r.busy) return tg.sendMessage(chatId, '⏳ Máy dựng đang bận — anh gửi lại lệnh sau ít phút nhé.');
    outPath = r.outPath || null;
    if (r.kind === 'info') return tg.sendMessage(chatId, r.note);
    if (r.kind === 'photo') return tg.sendPhotoFile(chatId, outPath, { caption: r.note, replyTo: msg.message_id });
    return tg.sendVideoFile(chatId, outPath, { caption: r.note, replyTo: msg.message_id });
  } catch (e) {
    console.error('Lỗi dựng video:', e.message);
    return tg.sendMessage(chatId, `❌ Dựng thất bại: ${String(e.message).slice(0, 220)}`);
  } finally {
    for (const p of [inPath, outPath]) if (p) fs.unlink(p, () => {});
  }
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from && msg.from.id;
  const text = (msg.text || msg.caption || '').trim();
  if (!text && !video.findVideoSource(msg)) return;

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

  // Quyền dùng bot: chủ bot (OWNER_IDS) hoặc admin của chính nhóm đang nhắn
  if (!isOwner(userId) && !(await isGroupAdmin(chatId, userId))) return;

  // --- Bot thợ DỰNG VIDEO: tin có video (hoặc reply vào 1 video) kèm lệnh dựng ---
  const vSource = video.findVideoSource(msg);
  const vCmd = video.parseVideoCommand(text);
  if (vCmd && !vSource) {
    return tg.sendMessage(chatId, '🎬 Lệnh dựng cần kèm video anh nhé: gửi video vào nhóm với chú thích là lệnh (ví dụ chú thích "/doc"), hoặc reply vào 1 video có sẵn rồi gõ lệnh.');
  }
  if (vSource && (vCmd || !text)) {
    return handleVideoCommand(chatId, msg, vSource, vCmd);
  }

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
        '🎬 <b>Bảng phân việc — đội sản xuất video:</b>',
        '',
        '🌸💋 <b>Yua Mikami</b> (GPT) — <b>Biên Kịch</b>: kịch bản video ngắn, hook 3 giây đầu, caption, tiêu đề, lời thoại, dịch phụ đề. → /yua',
        '😏🔥 <b>Eimi Fukada</b> (Claude) — <b>Đạo Diễn</b>: chiến lược kênh, đánh giá concept & kịch bản, kế hoạch series. → /eimi',
        '👑💋 <b>Yui Hatano</b> (Grok) — <b>Bắt Trend</b>: trend & nhạc đang hot, tra cứu, kiểm chứng thông tin. → /yui',
        '💙🌊 <b>Sora Aoi</b> (DeepSeek) — <b>Kỹ Thuật Dựng</b>: CapCut/Premiere, hiệu ứng, thông số xuất video, số liệu kênh. → /sora',
        '✨🌙 <b>Tsukasa Aoi</b> (Gemini) — <b>Phụ Đề & Đa Năng</b>: phụ đề, tóm tắt nội dung, việc thường ngày, dự phòng. → /tsukasa',
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

// Báo cáo doanh thu ngày hôm trước — 8:00 sáng giờ VN, vào nhóm điều hành (tắt tạm bằng AUTO_REPORTS=off)
if (AUTO_REPORTS && GROUP_CHAT_ID && revenue.configured()) {
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

// Báo cáo lead cuối ngày (21:00 giờ VN) vào nhóm điều hành (tắt tạm bằng AUTO_REPORTS=off)
if (AUTO_REPORTS && GROUP_CHAT_ID && leads.configured()) {
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
