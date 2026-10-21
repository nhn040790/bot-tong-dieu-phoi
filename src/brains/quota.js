// Quản lý hạn mức dùng theo ngày cho từng bộ não + "đỗ xe" bộ não khi bị giới hạn (HTTP 429)
// Đếm trong bộ nhớ (reset khi server khởi động lại) — đủ dùng vì chỉ chủ bot sử dụng.
const CAP = parseInt(process.env.BRAIN_DAILY_CAP || '300', 10);

let currentDay = todayVN();
const counts = {}; // brainId -> số lượt đã dùng hôm nay
const parked = {}; // brainId -> { until: timestamp ms, reason: string }

function todayVN() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Saigon' }).slice(0, 10);
}

function rollDay() {
  const t = todayVN();
  if (t !== currentDay) {
    currentDay = t;
    Object.keys(counts).forEach((k) => delete counts[k]);
    // Bộ não đỗ tới "ngày mai" tự hết hạn theo timestamp, không cần xóa
  }
}

// Kiểm tra bộ não có dùng được lúc này không
function canUse(id) {
  rollDay();
  const p = parked[id];
  if (p && p.until > Date.now()) {
    return { ok: false, reason: 'parked', until: p.until, note: p.reason };
  }
  if ((counts[id] || 0) >= CAP) {
    return { ok: false, reason: 'cap' };
  }
  return { ok: true };
}

function recordUse(id) {
  rollDay();
  counts[id] = (counts[id] || 0) + 1;
}

// Đỗ bộ não trong N phút (gặp rate limit)
function park(id, minutes, reason) {
  parked[id] = { until: Date.now() + minutes * 60 * 1000, reason: reason || 'rate limit' };
}

// Đỗ tới hết ngày (hết quota/ngân sách phía nhà cung cấp)
function parkTillTomorrow(id, reason) {
  const now = new Date();
  const vn = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Saigon' }));
  vn.setHours(24, 0, 0, 0);
  parked[id] = { until: Date.now() + (vn - new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Saigon' }))) + 60 * 1000, reason: reason || 'hết quota' };
}

function usedToday(id) {
  rollDay();
  return counts[id] || 0;
}

function parkedUntil(id) {
  const p = parked[id];
  return p && p.until > Date.now() ? p.until : null;
}

module.exports = { CAP, canUse, recordUse, park, parkTillTomorrow, usedToday, parkedUntil };
