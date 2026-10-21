// Bot thợ DỮ LIỆU: ghi lead vào Google Sheet + báo cáo
// Cấu trúc cột trong Sheet: Thời gian | Tên khách | SĐT | Nguồn | Trạng thái
// Cấu hình qua biến môi trường: GOOGLE_SA_JSON (JSON của service account), LEADS_SHEET_ID
const { google } = require('googleapis');

const SHEET_NAME = process.env.LEADS_SHEET_NAME || 'Leads';
let sheetsClient = null;

function configured() {
  return Boolean(process.env.GOOGLE_SA_JSON && process.env.LEADS_SHEET_ID);
}

function client() {
  if (!configured()) return null;
  if (!sheetsClient) {
    const creds = JSON.parse(process.env.GOOGLE_SA_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    sheetsClient = google.sheets({ version: 'v4', auth });
  }
  return sheetsClient;
}

function nowVN() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Saigon' }).slice(0, 16); // YYYY-MM-DD HH:mm
}

function todayVN() {
  return nowVN().slice(0, 10);
}

async function addLead({ name = '', phone, source = 'Telegram' }) {
  const s = client();
  if (!s) return { ok: false, reason: 'unconfigured' };
  await s.spreadsheets.values.append({
    spreadsheetId: process.env.LEADS_SHEET_ID,
    range: `${SHEET_NAME}!A:E`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[nowVN(), name, phone, source, 'Mới']] },
  });
  return { ok: true };
}

async function getAllLeads() {
  const s = client();
  if (!s) return null;
  const res = await s.spreadsheets.values.get({
    spreadsheetId: process.env.LEADS_SHEET_ID,
    range: `${SHEET_NAME}!A:E`,
  });
  const rows = res.data.values || [];
  return rows.slice(1).filter((r) => r && r[2]); // bỏ header, giữ dòng có SĐT
}

async function getLeadsToday() {
  const rows = await getAllLeads();
  if (!rows) return null;
  const t = todayVN();
  return rows.filter((r) => String(r[0]).startsWith(t));
}

function formatLeadList(rows, title) {
  if (!rows.length) return `${title}\nChưa có lead nào.`;
  const lines = [`${title} — <b>${rows.length} lead:</b>`];
  rows.forEach((r, i) => {
    lines.push(`${i + 1}. ${r[1] || '(chưa có tên)'} — ${r[2]} — ${r[3] || ''} — ${r[4] || 'Mới'}`);
  });
  return lines.join('\n');
}

module.exports = { configured, addLead, getLeadsToday, formatLeadList };
