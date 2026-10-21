// Tiện ích gọi Telegram Bot API
const TOKEN = process.env.BOT_TOKEN;
const API = `https://api.telegram.org/bot${TOKEN}`;

async function call(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error(`Telegram API ${method} lỗi:`, data.description);
  }
  return data;
}

function sendMessage(chatId, text, extra = {}) {
  return call('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  });
}

function sendTyping(chatId) {
  return call('sendChatAction', { chat_id: chatId, action: 'typing' });
}

async function setWebhook(url) {
  return call('setWebhook', { url, drop_pending_updates: true });
}

module.exports = { sendMessage, sendTyping, setWebhook };
