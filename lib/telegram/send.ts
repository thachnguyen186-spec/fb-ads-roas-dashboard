/**
 * Sends a Telegram message to the configured group/channel via Bot API.
 * No-ops (returns false) when env vars are missing — keeps dev/test from spamming.
 */
export async function sendTelegram(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn('[telegram] missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID — skipping send');
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('[telegram] send failed', res.status, body);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[telegram] send threw', err);
    return false;
  }
}
