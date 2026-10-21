// CÁC BỘ NÃO AI — Giai đoạn 2
// GPT (OpenAI) = "Thợ Chữ" — viết lách, dịch thuật
// Claude (Anthropic) = "Tham Mưu" — phân tích, tư vấn, lập kế hoạch
// Grok (xAI) = "Thám Tử" — tra cứu, hỏi đáp nhanh
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
    name: 'Thợ Chữ',
    icon: '✍️',
    brand: 'GPT',
    kind: 'openai',
    base: 'https://api.openai.com/v1',
    keyEnv: 'OPENAI_API_KEY',
    modelEnv: 'OPENAI_MODEL',
    defaultModel: 'gpt-4o-mini',
    style: 'Bạn là "Thợ Chữ" — chuyên viết lách: caption, bài đăng, tin nhắn chăm sóc khách, dịch Nhật↔Việt, đặt tiêu đề/slogan. Văn phong tự nhiên, cuốn hút nhưng không lố.',
  },
  claude: {
    id: 'claude',
    name: 'Tham Mưu',
    icon: '🧭',
    brand: 'Claude',
    kind: 'anthropic',
    keyEnv: 'ANTHROPIC_API_KEY',
    modelEnv: 'ANTHROPIC_MODEL',
    defaultModel: 'claude-haiku-4-5',
    style: 'Bạn là "Tham Mưu" — chuyên phân tích, tư vấn quyết định, lập kế hoạch, chỉ ra rủi ro và điểm mù. Trình bày có cấu trúc, kết luận rõ ràng, có lý do.',
  },
  grok: {
    id: 'grok',
    name: 'Thám Tử',
    icon: '🔎',
    brand: 'Grok',
    kind: 'openai',
    base: 'https://api.x.ai/v1',
    keyEnv: 'XAI_API_KEY',
    modelEnv: 'XAI_MODEL',
    defaultModel: 'grok-3-mini',
    style: 'Bạn là "Thám Tử" — chuyên tra cứu, giải đáp thắc mắc, kiểm chứng thông tin. Trả lời thẳng thắn, súc tích, phân biệt rõ điều chắc chắn và điều suy đoán.',
  },
  gemini: {
    id: 'gemini',
    name: 'Học Việc',
    icon: '🌱',
    brand: 'Gemini',
    kind: 'openai',
    base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyEnv: 'GEMINI_API_KEY',
    modelEnv: 'GEMINI_MODEL',
    defaultModel: 'gemini-2.5-flash',
    style: 'Bạn là "Học Việc" — trợ lý đa năng, nhận mọi việc được giao, trả lời rõ ràng và hữu ích.',
  },
};

const ORDER = ['gpt', 'claude', 'grok', 'gemini'];

function getKey(b) {
  if (process.env[b.keyEnv]) return process.env[b.keyEnv];
  if (b.id === 'gemini' && process.env.GOOGLE_AI_API_KEY) return process.env.GOOGLE_AI_API_KEY;
  return '';
}

function hasKey(id) {
  return Boolean(getKey(BRAINS[id]));
}

function modelOf(b) {
  return process.env[b.modelEnv] || b.defaultModel;
}

function systemPrompt(b) {
  return `${b.style}\n${SHOP_CONTEXT}`;
}

async function fetchJSON(url, options, timeoutMs = 60000) {
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
    const msg = (data.error && data.error.message) || `HTTP ${status}`;
    throw Object.assign(new Error(msg), { status, code: data.error && data.error.code });
  }
  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) throw new Error('Bộ não trả về rỗng');
  return text.trim();
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
    const msg = (data.error && data.error.message) || `HTTP ${status}`;
    throw Object.assign(new Error(msg), { status, code: data.error && data.error.type });
  }
  const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  if (!text) throw new Error('Bộ não trả về rỗng');
  return text.trim();
}

// Hỏi 1 bộ não cụ thể — trả { ok, text } hoặc { ok:false, reason }
async function ask(id, userText) {
  const b = BRAINS[id];
  if (!b) return { ok: false, reason: 'unknown' };
  const key = getKey(b);
  if (!key) return { ok: false, reason: 'no_key' };
  const gate = quota.canUse(id);
  if (!gate.ok) return { ok: false, reason: gate.reason, until: gate.until };

  try {
    const text = b.kind === 'anthropic' ? await callAnthropic(b, key, userText) : await callOpenAIStyle(b, key, userText);
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
    const gate = quota.canUse(id);
    return {
      id,
      name: b.name,
      icon: b.icon,
      brand: b.brand,
      model: modelOf(b),
      hasKey: hasKey(id),
      used: quota.usedToday(id),
      cap: quota.CAP,
      available: hasKey(id) && gate.ok,
      gateReason: gate.ok ? '' : gate.reason,
      parkedUntil: quota.parkedUntil(id),
    };
  });
}

module.exports = { BRAINS, ORDER, ask, hasKey, statusList };
