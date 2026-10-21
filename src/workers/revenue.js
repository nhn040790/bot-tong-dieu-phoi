// Bot thợ DOANH THU: đọc Sheet quản lý đơn "HikariGo" (tab Đơn hàng), cộng doanh thu theo Ngày lên đơn
// Định nghĩa doanh thu (user chốt 2026-10-21): Σ cột "Tổng tiền đơn" của các đơn có Ngày lên đơn = ngày cần tính,
// CHỈ tính đơn từ trạng thái Đã cọc trở đi — LOẠI "Chờ cọc" và "Đã Huỷ".
// Đơn "Chờ cọc" được liệt kê riêng ở cuối báo cáo để tiện theo dõi (chưa tính vào doanh thu).
// Cấu trúc tab Đơn hàng: dữ liệu từ dòng 8 · B=Khách hàng · C=Ngày lên đơn (DD/MM/YYYY) · E=Tên sản phẩm · G=Tình trạng · Y=Tổng tiền đơn
// Cấu hình: GOOGLE_SA_JSON (dùng chung với bot thợ Lead) + REVENUE_SHEET_ID
const { google } = require('googleapis');

const TAB = process.env.REVENUE_TAB || 'Đơn hàng';
let sheetsClient = null;

function configured() {
  return Boolean(process.env.GOOGLE_SA_JSON && process.env.REVENUE_SHEET_ID);
}

function client() {
  if (!configured()) return null;
  if (!sheetsClient) {
    const creds = JSON.parse(process.env.GOOGLE_SA_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    sheetsClient = google.sheets({ version: 'v4', auth });
  }
  return sheetsClient;
}

// "6.074.469 ₫" -> 6074469 · "–" / "" -> 0
function parseMoney(s) {
  const digits = String(s || '').replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

function fmtMoney(n) {
  return `${n.toLocaleString('vi-VN')} ₫`;
}

function pad(x) {
  return String(x).padStart(2, '0');
}

function ddmmyyyy(d) {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// Giờ tường Việt Nam (server Render chạy UTC)
function vnNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Saigon' }));
}

function todayStr() {
  return ddmmyyyy(vnNow());
}

function yesterdayStr() {
  const d = vnNow();
  d.setDate(d.getDate() - 1);
  return ddmmyyyy(d);
}

async function getRows() {
  const s = client();
  if (!s) return null;
  const res = await s.spreadsheets.values.get({
    spreadsheetId: process.env.REVENUE_SHEET_ID,
    range: `${TAB}!A8:AD1000`,
  });
  return res.data.values || [];
}

// Cộng doanh thu 1 ngày. rowsArg cho phép truyền dữ liệu sẵn (dùng khi kiểm thử).
async function revenueOf(dateStr, rowsArg) {
  const rows = rowsArg || (await getRows());
  if (!rows) return null;
  const orders = [];
  const pending = [];
  let total = 0;
  let pendingTotal = 0;
  for (const r of rows) {
    if (!r || String(r[2] || '').trim() !== dateStr) continue;
    const item = {
      customer: String(r[1] || '').trim(),
      product: String(r[4] || '').trim(),
      status: String(r[6] || '').trim(),
      amount: parseMoney(r[24]),
    };
    if (item.status === 'Chờ cọc') {
      pending.push(item);
      pendingTotal += item.amount;
    } else if (item.status === 'Đã Huỷ') {
      // đơn huỷ: bỏ hẳn, không tính và không liệt kê
    } else {
      orders.push(item);
      total += item.amount;
    }
  }
  return { dateStr, total, orders, pending, pendingTotal };
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatReport(rep) {
  if (!rep) return '⚠️ Chưa cấu hình Sheet doanh thu (thiếu GOOGLE_SA_JSON hoặc REVENUE_SHEET_ID trên Render).';
  const lines = [
    `📊 <b>Doanh thu ngày ${rep.dateStr}</b> <i>(chỉ tính đơn đã cọc trở đi)</i>`,
    `💰 Tổng: <b>${fmtMoney(rep.total)}</b> — ${rep.orders.length} đơn`,
  ];
  for (const o of rep.orders) {
    lines.push(`• ${esc(o.customer)} — ${esc(o.product)} — ${fmtMoney(o.amount)} (${esc(o.status)})`);
  }
  if (!rep.orders.length) lines.push('<i>Không có đơn nào đủ điều kiện tính doanh thu trong ngày này.</i>');
  if (rep.pending.length) {
    lines.push('', `⏳ <b>Chờ cọc (chưa tính doanh thu):</b> ${rep.pending.length} đơn — ${fmtMoney(rep.pendingTotal)}`);
    for (const o of rep.pending) {
      lines.push(`• ${esc(o.customer)} — ${esc(o.product)} — ${fmtMoney(o.amount)}`);
    }
  }
  return lines.join('\n');
}

async function reportYesterday() {
  return formatReport(await revenueOf(yesterdayStr()));
}

async function reportFor(dateStr) {
  return formatReport(await revenueOf(dateStr));
}

module.exports = { configured, revenueOf, formatReport, reportYesterday, reportFor, yesterdayStr, todayStr, parseMoney };
