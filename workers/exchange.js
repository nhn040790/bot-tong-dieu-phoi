// Bot thợ TRA CỨU: tỷ giá JPY→VND, tính cước bay/biển, quy đổi giá hàng yên→VND
// Giá cước HikariGo (đồng bộ chính sách hiện hành):
const CUOC_BAY = 160000; // VND/kg — đường bay, 5-7 ngày
const CUOC_BIEN = 95000; // VND/kg — đường biển, ~3 tháng
const PHI_MUA_HO = 0.02; // 2% — công thức: yên × 1.02 × tỷ giá

let cache = { rate: null, at: 0 };
const CACHE_MS = 30 * 60 * 1000;

async function getRate() {
  if (cache.rate && Date.now() - cache.at < CACHE_MS) return cache.rate;
  const res = await fetch('https://open.er-api.com/v6/latest/JPY');
  const data = await res.json();
  if (!data || !data.rates || !data.rates.VND) throw new Error('Không lấy được tỷ giá');
  cache = { rate: data.rates.VND, at: Date.now() };
  return cache.rate;
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
  const rate = await getRate();
  return (
    `💴 <b>Tỷ giá yên hôm nay (tham khảo):</b> 1 yên ≈ <b>${rate.toFixed(2)}đ</b>\n` +
    `<i>Lưu ý: tỷ giá shop áp dụng tính theo thời điểm khách thanh toán, cập nhật theo ngày.</i>`
  );
}

// Quy đổi tiền hàng: yên × 1.02 × tỷ giá (đã gồm phí mua hộ 2%)
async function quyDoiGia(yen) {
  const rate = await getRate();
  const tong = yen * (1 + PHI_MUA_HO) * rate;
  return (
    `🛒 <b>Quy đổi ${fmt(yen)} yên:</b>\n` +
    `Tiền hàng + phí mua hộ 2%: ≈ <b>${fmt(tong)}đ</b>\n` +
    `<i>Công thức: ${fmt(yen)} × 1,02 × ${rate.toFixed(2)}đ. Chưa gồm cước vận chuyển theo kg.</i>`
  );
}

module.exports = { getRate, parseCuoc, traCuoc, traTyGia, quyDoiGia, CUOC_BAY, CUOC_BIEN };
