// Bot thợ DỰNG VIDEO (Lớp 2): nhận file video trong nhóm → dựng bằng ffmpeg → Bot Tổng gửi lại bản đã xử lý
// Lệnh: /doc (khung dọc 9:16, nền mờ) · /vuong (1:1) · /ngang (16:9) · /cat <từ giây> [đến giây] · /tocdo <hệ số>
//       /chu <nội dung> (chèn chữ dưới video) · /anh (trích khung hình) · /info (độ dài/kích thước/dung lượng)
// Giới hạn cứng của Telegram Bot API: bot chỉ TẢI được file tối đa 20MB, GỬI được tối đa 50MB → chỉ hợp clip ngắn.
// Xử lý 1 video tại 1 thời điểm (server nhỏ) — bận thì báo bận, không xếp hàng chồng chất.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let ffmpegPath = null;
let ffprobePath = null;
try {
  ffmpegPath = require('ffmpeg-static');
} catch {}
try {
  ffprobePath = require('ffprobe-static').path;
} catch {}

const FONT = path.join(__dirname, '..', '..', 'assets', 'fonts', 'Roboto-Bold.ttf');
const MAX_INPUT = 20 * 1024 * 1024; // 20MB — trần tải file của Telegram Bot API
const JOB_TIMEOUT_MS = 8 * 60 * 1000;
let busy = false;

function ready() {
  return Boolean(ffmpegPath);
}
function isBusy() {
  return busy;
}

function run(cmd, args, timeoutMs = JOB_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let out = '';
    let err = '';
    const killer = setTimeout(() => {
      p.kill('SIGKILL');
      reject(new Error('Quá thời gian xử lý (8 phút) — video có thể quá dài/nặng so với server.'));
    }, timeoutMs);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => {
      clearTimeout(killer);
      reject(e);
    });
    p.on('close', (code) => {
      clearTimeout(killer);
      if (code === 0) resolve({ out, err });
      else reject(new Error(`ffmpeg lỗi (mã ${code}): ${err.split('\n').slice(-3).join(' ').slice(0, 220)}`));
    });
  });
}

async function probe(file) {
  if (!ffprobePath) return null;
  const { out } = await run(
    ffprobePath,
    ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_type,width,height', '-of', 'json', file],
    30000
  );
  const j = JSON.parse(out);
  const v = ((j.streams || []).find((s) => s.codec_type === 'video') || {});
  return {
    duration: j.format && j.format.duration ? parseFloat(j.format.duration) : 0,
    width: v.width || 0,
    height: v.height || 0,
    size: j.format && j.format.size ? parseInt(j.format.size, 10) : 0,
  };
}

function fmtDur(sec) {
  if (!sec) return '?';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m} phút ${s} giây` : `${s} giây`;
}
function fmtMB(n) {
  return n ? `${(n / 1024 / 1024).toFixed(1)}MB` : '?';
}

// Bộ lọc "đệm nền mờ": video gốc nằm giữa, phần thừa phủ bằng chính video phóng to + làm mờ
function padFC(w, h) {
  return (
    `split[a][b];` +
    `[a]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=20:5[bg];` +
    `[b]scale=${w}:${h}:force_original_aspect_ratio=decrease[fg];` +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]`
  );
}

function escapeDrawtext(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

function atempoChain(x) {
  const parts = [];
  let v = x;
  while (v > 2.0) {
    parts.push('atempo=2');
    v /= 2;
  }
  while (v < 0.5) {
    parts.push('atempo=0.5');
    v /= 0.5;
  }
  parts.push(`atempo=${v.toFixed(3)}`);
  return parts.join(',');
}

const ENC = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart'];

// Dựng 1 lệnh. Trả { kind: 'video'|'photo'|'info', outPath?, note }
async function processCommand(inPath, cmd, arg) {
  if (!ready()) throw new Error('Máy dựng chưa sẵn sàng (thiếu ffmpeg trên server).');
  if (busy) return { busy: true };
  busy = true;
  try {
    const meta = await probe(inPath).catch(() => null);
    const stamp = Date.now();
    if (cmd === 'info') {
      const note = meta
        ? `ℹ️ <b>Thông tin video:</b>\n⏱ Độ dài: ${fmtDur(meta.duration)}\n📐 Khung hình: ${meta.width}×${meta.height}\n💾 Dung lượng: ${fmtMB(meta.size)}`
        : 'ℹ️ Không đọc được thông tin video này.';
      return { kind: 'info', note };
    }
    if (cmd === 'anh') {
      const outPath = path.join(os.tmpdir(), `vid_frame_${stamp}.jpg`);
      await run(ffmpegPath, ['-y', '-ss', '1', '-i', inPath, '-frames:v', '1', '-q:v', '3', outPath], 60000);
      return { kind: 'photo', outPath, note: '🖼 Khung hình trích từ video (giây thứ 1) — dùng làm ảnh bìa/thumbnail được luôn anh.' };
    }
    const outPath = path.join(os.tmpdir(), `vid_out_${stamp}.mp4`);
    if (cmd === 'doc' || cmd === 'vuong' || cmd === 'ngang') {
      const [w, h] = cmd === 'doc' ? [720, 1280] : cmd === 'vuong' ? [1080, 1080] : [1280, 720];
      const label = cmd === 'doc' ? 'dọc 9:16' : cmd === 'vuong' ? 'vuông 1:1' : 'ngang 16:9';
      await run(ffmpegPath, ['-y', '-i', inPath, '-filter_complex', padFC(w, h), '-map', '[v]', '-map', '0:a?', ...ENC, outPath]);
      const m2 = await probe(outPath).catch(() => null);
      return { kind: 'video', outPath, note: `🎬 Đã đổi khung ${label} (${w}×${h}, nền mờ) — ⏱ ${fmtDur(m2 ? m2.duration : 0)} · 💾 ${fmtMB(m2 ? m2.size : 0)}` };
    }
    if (cmd === 'cat') {
      const nums = (arg || '').match(/\d+(?:[.,]\d+)?/g) || [];
      if (!nums.length) throw new Error('Thiếu số giây. Ví dụ: /cat 10 (lấy 10 giây đầu) hoặc /cat 5 20 (từ giây 5 đến 20).');
      const a = parseFloat(nums[0].replace(',', '.'));
      const hasRange = nums.length >= 2;
      const b = hasRange ? parseFloat(nums[1].replace(',', '.')) : null;
      const start = hasRange ? a : 0;
      const len = hasRange ? b - a : a;
      if (!(len > 0)) throw new Error('Khoảng cắt không hợp lệ — giây kết thúc phải lớn hơn giây bắt đầu.');
      if (meta && start >= meta.duration) throw new Error(`Video chỉ dài ${fmtDur(meta.duration)} — giây bắt đầu ${start} vượt quá video.`);
      await run(ffmpegPath, ['-y', '-ss', String(start), '-i', inPath, '-t', String(len), ...ENC, outPath]);
      const m2 = await probe(outPath).catch(() => null);
      return { kind: 'video', outPath, note: `✂️ Đã cắt ${hasRange ? `từ giây ${a} đến ${b}` : `${a} giây đầu`} — ⏱ ${fmtDur(m2 ? m2.duration : 0)} · 💾 ${fmtMB(m2 ? m2.size : 0)}` };
    }
    if (cmd === 'tocdo') {
      const x = parseFloat(String(arg || '').replace(',', '.'));
      if (!x || x < 0.25 || x > 4) throw new Error('Hệ số tốc độ phải từ 0.25 đến 4. Ví dụ: /tocdo 1.5 hoặc /tocdo 0.5.');
      await run(ffmpegPath, ['-y', '-i', inPath, '-filter:v', `setpts=PTS/${x}`, '-filter:a', atempoChain(x), ...ENC, outPath]);
      const m2 = await probe(outPath).catch(() => null);
      return { kind: 'video', outPath, note: `⏩ Đã chỉnh tốc độ ${x}x — ⏱ còn ${fmtDur(m2 ? m2.duration : 0)} · 💾 ${fmtMB(m2 ? m2.size : 0)}` };
    }
    if (cmd === 'chu') {
      const text = (arg || '').trim();
      if (!text) throw new Error('Thiếu nội dung chữ. Ví dụ: /chu Hàng Nhật chính hãng');
      if (!fs.existsSync(FONT)) throw new Error('Thiếu file font trên server — báo Muse bổ sung.');
      const dt = `drawtext=fontfile=${FONT}:text='${escapeDrawtext(text)}':fontcolor=white:fontsize=46:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h-text_h-36,scale=trunc(iw/2)*2:trunc(ih/2)*2`;
      await run(ffmpegPath, ['-y', '-i', inPath, '-vf', dt, ...ENC, outPath]);
      const m2 = await probe(outPath).catch(() => null);
      return { kind: 'video', outPath, note: `🔤 Đã chèn chữ "${text.slice(0, 60)}" — ⏱ ${fmtDur(m2 ? m2.duration : 0)} · 💾 ${fmtMB(m2 ? m2.size : 0)}` };
    }
    throw new Error(`Lệnh dựng "${cmd}" chưa hỗ trợ.`);
  } finally {
    busy = false;
  }
}

const VIDEO_COMMANDS = ['doc', 'vuong', 'ngang', 'cat', 'tocdo', 'chu', 'anh', 'info'];

function parseVideoCommand(text) {
  const m = String(text || '').match(/^\/(doc|vuong|ngang|cat|tocdo|chu|anh|info)\b[ \t]*([\s\S]*)$/i);
  if (!m) return null;
  return { cmd: m[1].toLowerCase(), arg: (m[2] || '').trim() };
}

// Tìm file video trong tin nhắn (hoặc trong tin được reply)
function findVideoSource(msg) {
  for (const m of [msg, msg && msg.reply_to_message]) {
    if (!m) continue;
    if (m.video) return { fileId: m.video.file_id, fileSize: m.video.file_size || 0 };
    if (m.animation) return { fileId: m.animation.file_id, fileSize: m.animation.file_size || 0 };
    if (m.document && String(m.document.mime_type || '').startsWith('video/')) {
      return { fileId: m.document.file_id, fileSize: m.document.file_size || 0 };
    }
  }
  return null;
}

const VIDEO_HELP = [
  '🎬 <b>Dựng video — cách dùng:</b> gửi video vào nhóm kèm chú thích là lệnh, hoặc reply vào 1 video rồi gõ lệnh:',
  '/doc — khung dọc 9:16 (nền mờ) cho TikTok/Reels',
  '/vuong — khung vuông 1:1 · /ngang — khung ngang 16:9',
  '/cat 10 — lấy 10 giây đầu · /cat 5 20 — cắt giây 5→20',
  '/tocdo 1.5 — nhanh 1.5x · /tocdo 0.5 — chậm một nửa',
  '/chu Nội dung — chèn chữ dưới video',
  '/anh — trích khung hình làm ảnh · /info — xem thông tin video',
  '<i>Giới hạn: bot tải được video tối đa 20MB (trần của Telegram) — hợp clip ngắn.</i>',
].join('\n');

module.exports = { ready, isBusy, MAX_INPUT, processCommand, parseVideoCommand, findVideoSource, VIDEO_HELP, VIDEO_COMMANDS };
