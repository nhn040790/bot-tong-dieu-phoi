// CÁC BỘ NÃO AI — Giai đoạn 2
// GPT (OpenAI) = "Thợ Chữ" — viết lách, dịch thuật
// Claude (Anthropic) = "Tham Mưu" — phân tích, tư vấn, lập kế hoạch
// Grok (xAI) = "Thám Tử" — tra cứu, hỏi đáp nhanh
// DeepSeek = "Thợ Tính" — suy luận, tính toán, code, giá rẻ
// Gemini (Google) = "Học Việc" — MIỄN PHÍ, dự phòng khi các não kia hết lượt/chưa có key
// Key + model cấu hình qua biến môi trường; đổi model không cần sửa code.
const quota = require('./quota');

const SHOP_CONTEXT = [
  'Bối cảnh: bạn đang hỗ trợ shop HikariGo — dịch vụ mua hộ, đấu giá và vận chuyển hàng từ Nhật về Việt Nam.',
  'Dữ kiện shop (chỉ dùng khi liên quan): cước bay 160.000đ/kg (5-7 ngày), cước biển 95.000đ/kg (khoảng 3 tháng);',
  'phí mua hộ 2% (đơn trên 100.000 yên thì phí thanh toán 1%); giá hàng = yên × 1,02 × tỷ giá (giá bán Vietcombank, theo ngày thanh toán);',
  'kho Nhật ở Chiba, kho Việt Nam ở Hà Nội; hotline 0984.777.000.',
  'Quy tắc: trả lời bằng tiếng Việt trừ khi được yêu cầu ngôn ngữ khác; ngắn gọn, thực tế, đi thẳng vào việc;',
  'không bịa số liệu — nếu cần dữ kiện thời gian thực mà bạn không có (tỷ giá, tin mới) thì nói rõ thay vì đoán.',
].join(' ');

const BRAINS = {
  gpt: {
    id: 'gpt',
    name: 'Yua Mikami',
    icon: '🌸💋',
    brand: 'GPT',
    kind: 'openai',
    base: 'https://api.openai.com/v1',
    keyEnv: 'OPENAI_API_KEY',
    modelEnv: 'OPENAI_MODEL',
    defaultModel: 'gpt-4o-mini',
    style: 'chuyên viết lách: caption, bài đăng, tin nhắn chăm sóc khách, dịch Nhật↔Việt, đặt tiêu đề/slogan. Văn phong tự nhiên, cuốn hút nhưng không lố.',
  },
  claude: {
    id: 'claude',
    name: 'Eimi Fukada',
    icon: '😏🔥',
    brand: 'Claude',
    kind: 'anthropic',
    keyEnv: 'ANTHROPIC_API_KEY',
    modelEnv: 'ANTHROPIC_MODEL',
    defaultModel: 'claude-haiku-4-5',
    style: 'chuyên phân tích, tư vấn quyết định, lập kế hoạch, chỉ ra rủi ro và điểm mù. Trình bày có cấu trúc, kết luận rõ ràng, có lý do.',
  },
  grok: {
    id: 'grok',
    name: 'Yui Hatano',
    icon: '👑💋',
    brand: 'Grok',
    kind: 'openai',
    base: 'https://api.x.ai/v1',
    keyEnv: 'XAI_API_KEY',
    modelEnv: 'XAI_MODEL',
    defaultModel: 'grok-3-mini',
    style: 'chuyên tra cứu, giải đáp thắc mắc, kiểm chứng thông tin. Trả lời thẳng thắn, súc tích, phân biệt rõ điều chắc chắn và điều suy đoán.',
  },
  deepseek: {
    id: 'deepseek',
    name: 'Sora Aoi',
    icon: '💙🌊',
    brand: 'DeepSeek',
    kind: 'openai',
    base: 'https://api.deepseek.com',
    keyEnv: 'DEEPSEEK_API_KEY',
    modelEnv: 'DEEPSEEK_MODEL',
    defaultModel: 'deepseek-chat',
    style: 'chuyên suy luận, tính toán, việc kỹ thuật và lập trình. Trình bày rõ ràng, có bước đi, kiểm tra lại kết quả trước khi kết luận.',
  },
  gemini: {
    id: 'gemini',
    name: 'Tsukasa Aoi',
    icon: '✨🌙',
    brand: 'Gemini',
    kind: 'gemini',
    keyEnv: 'GEMINI_API_KEY',
    modelEnv: 'GEMINI_MODEL',
    defaultModel: 'gemini-3.8-flash',
    style: 'là trợ lý đa năng, nhận mọi việc được giao, trả lời rõ ràng và hữu ích.',
  },
};

const ORDER = ['gpt', 'claude', 'grok', 'deepseek', 'gemini'];

// Tên + biểu tượng hiển thị có thể đổi ngay trên Render, không cần sửa code:
// BRAIN_NAME_GPT / BRAIN_ICON_GPT / BRAIN_NAME_CLAUDE / ... (để trống = dùng mặc định)
function label(id) {
  const b = BRAINS[id];
  return {
    name: process.env[`BRAIN_NAME_${id.toUpperCase()}`] || b.name,
    icon: process.env[`BRAIN_ICON_${id.toUpperCase()}`] || b.icon,
  };
}

function getKey(b) {
  if (process.env[b.keyEnv]) return process.env[b.keyEnv];
  if (b.id === 'gemini' && process.env.GOOGLE_AI_API_KEY) return process.env.GOOGLE_AI_API_KEY;
  return '';
}

// Token tài khoản bot RIÊNG của từng bộ não (tạo qua BotFather, dán vào Render):
// có token => bộ não tự gửi tin bằng tài khoản của mình (tên + avatar riêng trong nhóm);
// chưa có => Bot Tổng gửi thay kèm nhãn tên như cũ.
const BOT_TOKEN_ENVS = { gpt: 'BOT_TOKEN_GPT', claude: 'BOT_TOKEN_CLAUDE', grok: 'BOT_TOKEN_GROK', deepseek: 'BOT_TOKEN_DEEPSEEK', gemini: 'BOT_TOKEN_GEMINI' };

function botToken(id) {
  return process.env[BOT_TOKEN_ENVS[id]] || '';
}

function hasKey(id) {
  return Boolean(getKey(BRAINS[id]));
}

function modelOf(b) {
  return process.env[b.modelEnv] || b.defaultModel;
}

function systemPrompt(b) {
  const L = label(b.id);
  return `Tên của bạn là "${L.name}" — một thành viên trong đội trợ lý AI của shop, ${b.style}\n${SHOP_CONTEXT}`;
}

// Trích thông điệp lỗi từ phản hồi của hãng — xAI trả error dạng CHUỖI, OpenAI/Anthropic/Gemini trả dạng OBJECT có .message
function errMsg(data, status) {
  const e = data && data.error;
  if (typeof e === 'string' && e) return e;
  if (e && e.message) return e.message;
  if (data && data.message) return data.message;
  return `HTTP ${status}`;
}

async function fetchJSON(url, options, timeoutMs = 120000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  } finally {
    clearTimeout(t);
  }
}

// GPT / Grok / Gemini dùng chung chuẩn OpenAI chat completions
async function callOpenAIStyle(b, key, userText) {
  const { status, data } = await fetchJSON(`${b.base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: modelOf(b),
      messages: [
        { role: 'system', content: systemPrompt(b) },
        { role: 'user', content: userText },
      ],
      max_tokens: 2000,
    }),
  });
  if (status !== 200) {
    const msg = errMsg(data, status);
    throw Object.assign(new Error(msg), { status, code: data.error && data.error.code });
  }
  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) throw new Error('Bộ não trả về rỗng');
  return text.trim();
}

// Gemini qua API chính thức (generateContent) — ổn định nhất cho key lấy từ AI Studio
async function callGemini(b, key, userText) {
  const { status, data } = await fetchJSON(`https://generativelanguage.googleapis.com/v1beta/models/${modelOf(b)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt(b) }] },
      contents: [{ parts: [{ text: userText }] }],
      generationConfig: { maxOutputTokens: 2000 },
    }),
  });
  if (status !== 200) {
    const msg = errMsg(data, status);
    throw Object.assign(new Error(msg), { status, code: data.error && data.error.status });
  }
  const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
  const text = (parts || []).map((p) => p.text || '').join('\n').trim();
  if (!text) throw new Error('Bộ não trả về rỗng');
  return text;
}

async function callAnthropic(b, key, userText) {
  const { status, data } = await fetchJSON('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: modelOf(b),
      max_tokens: 2000,
      system: systemPrompt(b),
      messages: [{ role: 'user', content: userText }],
    }),
  });
  if (status !== 200) {
    const msg = errMsg(data, status);
    throw Object.assign(new Error(msg), { status, code: data.error && data.error.type });
  }
  const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  if (!text) throw new Error('Bộ não trả về rỗng');
  return text.trim();
}

// Lỗi tạm thời (treo kết nối, bị ngắt, lỗi 5xx phía nhà cung cấp) thì đáng thử lại 1 lần
function isRetryable(err) {
  if (err.status >= 500) return true;
  return /aborted|abort|fetch failed|network|socket|timeout|timed out|ECONN|ETIMEDOUT/i.test(err.message || '');
}

// Hỏi 1 bộ não cụ thể — trả { ok, text } hoặc { ok:false, reason }
async function ask(id, userText) {
  const b = BRAINS[id];
  if (!b) return { ok: false, reason: 'unknown' };
  const key = getKey(b);
  if (!key) return { ok: false, reason: 'no_key' };
  const gate = quota.canUse(id);
  if (!gate.ok) return { ok: false, reason: gate.reason, until: gate.until };

  const callOnce = () =>
    b.kind === 'anthropic' ? callAnthropic(b, key, userText) : b.kind === 'gemini' ? callGemini(b, key, userText) : callOpenAIStyle(b, key, userText);

  try {
    let text;
    try {
      text = await callOnce();
    } catch (e1) {
      if (!isRetryable(e1)) throw e1;
      console.error(`Bộ não ${id} lỗi tạm thời (${e1.message}) — thử lại sau 2 giây`);
      await new Promise((r) => setTimeout(r, 2000));
      text = await callOnce();
    }
    quota.recordUse(id);
    return { ok: true, text };
  } catch (err) {
    console.error(`Bộ não ${id} lỗi:`, err.message);
    if (err.status === 429) {
      if (/quota|insufficient|billing/i.test(err.message) || err.code === 'insufficient_quota') {
        quota.parkTillTomorrow(id, 'hết quota/ngân sách');
        return { ok: false, reason: 'quota' };
      }
      quota.park(id, 30, 'rate limit');
      return { ok: false, reason: 'rate_limit' };
    }
    if (err.status === 401 || err.status === 403) return { ok: false, reason: 'bad_key' };
    return { ok: false, reason: 'error', message: err.message };
  }
}

function statusList() {
  return ORDER.map((id) => {
    const b = BRAINS[id];
    const L = label(id);
    const gate = quota.canUse(id);
    return {
      id,
      name: L.name,
      icon: L.icon,
      brand: b.brand,
      model: modelOf(b),
      hasKey: hasKey(id),
      hasBot: Boolean(botToken(id)),
      used: quota.usedToday(id),
      cap: quota.CAP,
      available: hasKey(id) && gate.ok,
      gateReason: gate.ok ? '' : gate.reason,
      parkedUntil: quota.parkedUntil(id),
    };
  });
}

module.exports = { BRAINS, ORDER, ask, hasKey, statusList, label, botToken };
