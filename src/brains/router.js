// BỘ ĐỊNH TUYẾN việc tự do → bộ não phù hợp theo BẢNG PHÂN VIỆC, tự chuyển não dự phòng khi não chính bận/hết lượt
// Bảng phân việc: Yua (GPT) = viết lách/nội dung · Eimi (Claude) = phân tích/tư vấn · Yui (Grok) = tra cứu/kiểm chứng
//                Sora (DeepSeek) = tính toán/số liệu/code · Tsukasa (Gemini) = tóm tắt/việc thường ngày/dự phòng
const brains = require('./brains');

const WRITE_RE = /viết|soạn|caption|bài đăng|nội dung|quảng cáo|dịch|slogan|tiêu đề|status|văn mẫu|tin nhắn mẫu|thông báo|fanpage/i;
const ANALYZE_RE = /phân tích|tư vấn|chiến lược|kế hoạch|so sánh|đánh giá|tại sao|giải thích|nên không|nên chọn|ưu nhược|góp ý|khiếu nại|phàn nàn|khách chê|xử lý thế nào|marketing|rủi ro/i;
const LOOKUP_RE = /tra cứu|tìm hiểu|tin tức|mới nhất|hiện nay|ai là|ở đâu|có thật không|kiểm chứng|xác minh|thật không|tin đồn/i;
const CALC_RE = /tính toán|tính cước|tính giá|quy đổi|suy luận|công thức|hàm excel|bao nhiêu tiền|tổng cộng/i;
const CODE_RE = /lập trình|viết code|code\b|script|bug|debug/i;
const SUMMARY_RE = /tóm tắt|rút gọn|tổng hợp lại|ngắn gọn lại|dài quá/i;

// Đoán bộ não hợp nhất với việc này
function pick(text) {
  if (CODE_RE.test(text)) return 'deepseek';
  if (SUMMARY_RE.test(text)) return 'gemini';
  if (WRITE_RE.test(text)) return 'gpt';
  if (ANALYZE_RE.test(text)) return 'claude';
  if (LOOKUP_RE.test(text)) return 'grok';
  if (CALC_RE.test(text)) return 'deepseek';
  return 'gpt';
}

// Thứ tự thử: não được chọn trước, sau đó các não còn lại theo thứ tự ưu tiên
function chain(startId) {
  return [startId, ...brains.ORDER.filter((id) => id !== startId)];
}

// Hỏi tự động: thử lần lượt cho tới khi 1 bộ não trả lời được
async function askAuto(text) {
  const start = pick(text);
  const notes = [];
  for (const id of chain(start)) {
    if (!brains.hasKey(id)) continue;
    const r = await brains.ask(id, text);
    if (r.ok) return { ok: true, brainId: id, text: r.text, fellBack: id !== start };
    notes.push(`${brains.label(id).name}: ${r.reason}${r.message ? ' — ' + r.message : ''}`);
  }
  return { ok: false, notes };
}

// Hỏi tất cả các bộ não đang có key (phục vụ /hoi3nao)
async function askAll(text) {
  const ids = brains.ORDER.filter((id) => brains.hasKey(id));
  return Promise.all(
    ids.map(async (id) => {
      const r = await brains.ask(id, text);
      return { brainId: id, ...r };
    })
  );
}

module.exports = { pick, askAuto, askAll };
