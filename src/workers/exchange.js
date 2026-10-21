// Bot thợ TRA CỨU: tỷ giá JPY→VND, tính cước bay/biển, quy đổi giá hàng yên→VND
// Giá cước HikariGo (đồng bộ chính sách hiện hành):
const CUOC_BAY = 160000; // VND/kg — đường bay, 5-7 ngày
const CUOC_BIEN = 95000; // VND/kg — đường biển, ~3 tháng
const PHI_MUA_HO = 0.02; // 2% — công thức: yên × 1.02 × tỷ giá

let cache = { rate: null, source: '', updated: '', at: 0 };
const CACHE_MS = 30 * 60 * 1000; // Vietcombank yêu cầu tối đa 1 lần gọi / 5 phút — cache 30 phút

// Nguồn chính: giá BÁN JPY của Vietcombank (API JSON trên website vietcombank.com.vn)
async function fetchVCB() {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Saigon' }); // YYYY-MM-DD
  const res = await fetch(`https://www.vietcombank.com.vn/api/exchangerates?date=${today}`);
  const data = await res.json();
  const jpy = (data.Data || []).find((d) => d.currencyCode === 'JPY');
  if (!jpy || !jpy.sell) throw new Error('Không thấy JPY trong dữ liệu Vietcombank');
  return { rate: parseFloat(jpy.sell), source: 'Vietcombank (giá bán)', updated: data.UpdatedDate || '' };
}

// Nguồn dự phòng: tỷ giá thị trường quốc tế (open.er-api.com)
async function fetchMarket() {
  const res = await fetch('https://open.er-api.com/v6/latest/JPY');
  const data = await res.json();
  if (!data || !data.rates || !data.rates.VND) throw new Error('Không lấy được tỷ giá dự phòng');
  return { rate: data.rates.VND, source: 'thị trường quốc tế (dự phòng — Vietcombank không phản hồi)', updated: '' };
}

async function getRateInfo() {
  if (cache.rate && Date.now() - cache.at < CACHE_MS) return cache;
  try {
    cache = { ...(await fetchVCB()), at: Date.now() };
  } catch (e) {
    console.error('Lỗi lấy tỷ giá Vietcombank, dùng dự phòng:', e.message);
    cache = { ...(await fetchMarket()), at: Date.now() };
  }
  return cache;
}

async function getRate() {
  return (await getRateInfo()).rate;
}

function fmt(n) {
  return Math.round(n).toLocaleString('vi-VN');
}

// Nhận diện "3kg bay", "2,5 kg biển", "5kg đường biển" trong tin nhắn tự do
function parseCuoc(text) {
  const m = text.toLowerCase().match(/(\d+(?:[.,]\d+)?)\s*kg/);
  if (!m) return null;
  const kg = parseFloat(m[1].replace(',', '.'));
  let loai = null;
  if (/(biển|bien|sea|tàu|tau)/.test(text.toLowerCase())) loai = 'bien';
  else if (/(bay|air|hàng không|hang khong)/.test(text.toLowerCase())) loai = 'bay';
  return { kg, loai };
}

async function traCuoc(kg, loai) {
  const lines = [`🧮 <b>Tính cước cho ${kg} kg:</b>`];
  if (!loai || loai === 'bay') {
    lines.push(`✈️ Đường bay (5-7 ngày): ${fmt(kg * CUOC_BAY)}đ (${fmt(CUOC_BAY)}đ/kg)`);
  }
  if (!loai || loai === 'bien') {
    lines.push(`🚢 Đường biển (~3 tháng): ${fmt(kg * CUOC_BIEN)}đ (${fmt(CUOC_BIEN)}đ/kg)`);
  }
  lines.push('<i>Cước chỉ gồm vận chuyển Nhật → kho Hà Nội; phí nội địa VN do đơn vị giao hàng thu riêng.</i>');
  return lines.join('\n');
}

async function traTyGia() {
  const info = await getRateInfo();
  const rateStr = info.rate.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let upd = '';
  if (info.updated) {
    const d = new Date(info.updated);
    upd = ` (VCB cập nhật lúc ${d.toLocaleTimeString('vi-VN', { timeZone: 'Asia/Saigon', hour: '2-digit', minute: '2-digit' })} ${d.toLocaleDateString('vi-VN', { timeZone: 'Asia/Saigon' })})`;
  }
  return (
    `💴 <b>Tỷ giá yên theo ${info.source}:</b> 1 yên = <b>${rateStr}đ</b>${upd}\n` +
    `<i>Đây là giá bán JPY của Vietcombank; tỷ giá shop áp dụng tính theo thời điểm khách thanh toán.</i>`
  );
}

// Quy đổi tiền hàng: yên × 1.02 × tỷ giá (đã gồm phí mua hộ 2%)
async function quyDoiGia(yen) {
  const rate = await getRate();
  const tong = yen * (1 + PHI_MUA_HO) * rate;
  return (
    `🛒 <b>Quy đổi ${fmt(yen)} yên:</b>\n` +
    `Tiền hàng + phí mua hộ 2%: ≈ <b>${fmt(tong)}đ</b>\n` +
    `<i>Công thức: ${fmt(yen)} × 1,02 × tỷ giá bán VCB ${rate.toLocaleString('vi-VN', { minimumFractionDigits: 2 })}đ. Chưa gồm cước vận chuyển theo kg.</i>`
  );
}

module.exports = { getRate, parseCuoc, traCuoc, traTyGia, quyDoiGia, CUOC_BAY, CUOC_BIEN };
