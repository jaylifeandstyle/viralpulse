// src/lib/telegram.ts
//
// Sends a formatted opportunity to a Telegram chat. Used as a push channel
// alongside the dashboard — your "assistant" gets a Markdown card with the
// draft, score, image-search link, and reasoning the moment a galaxy approves
// an opportunity.
//
// ───────────────────────────────────────────────────────────────────────────
// SETUP — use the guided script. It catches the common pitfalls.
// ───────────────────────────────────────────────────────────────────────────
//   1. Telegram → message @BotFather → /newbot → save the token it gives you.
//      A real token looks like:  1234567890:AAEhBP0av1nFw9DjU7ZGSzlYLcUmtGTzWnY
//      (numeric ID  +  colon  +  35+ alphanumeric chars — no <>, no spaces)
//
//   2. Add to .env.local:
//        TELEGRAM_BOT_TOKEN=1234567890:AAEhBP0av1nFw9DjU7ZGSzlYLcUmtGTzWnY
//
//   3. Run:  npm run telegram:setup
//      The script validates the token, finds your chat_id, sends a test
//      message, and tells you exactly what to fix if anything's wrong.
//
//   4. Add the chat_id it printed to .env.local and re-run the script:
//        TELEGRAM_CHAT_ID=12345678
//
// If you DO want to fetch updates manually in a browser, the URL is:
//   https://api.telegram.org/bot<paste-real-token>/getUpdates
// Common 404 cause: leaving "<paste-real-token>" literal in the URL.
// The script avoids that whole class of error.
//
// If either env var is missing, sendOpportunityToTelegram silently no-ops —
// you can leave the integration wired in without configuring it.

import type { StoredOpportunity } from '@/store/opportunity-store';

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️  TESTING MODE  ⚠️
// true  → notify on every push (good for verifying the pipeline)
// false → only notify on high-quality opps (shouldAct true OR score ≥ 60)
// ─────────────────────────────────────────────────────────────────────────────
const TESTING_MODE = true;

const MIN_SCORE_TO_NOTIFY_PROD = 60;
const TELEGRAM_API_TIMEOUT_MS = 5000;

/**
 * One-time configuration banner. Logged on FIRST call only.
 * Tells you immediately whether Telegram is wired up — eliminates the silent
 * no-op failure mode where a stale process has no token loaded.
 */
let _configLogged = false;
function logConfigOnce(token: string | undefined, chatId: string | undefined): void {
  if (_configLogged) return;
  _configLogged = true;
  if (!token && !chatId) {
    console.warn('📱 Telegram DISABLED — TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID not set in env. Every push will silently no-op until restart with env vars loaded.');
    return;
  }
  if (!token) {
    console.warn('📱 Telegram DISABLED — TELEGRAM_BOT_TOKEN missing from env (chat_id is set). Likely a stale process: env was added to .env.local after this process started. Restart to pick it up.');
    return;
  }
  if (!chatId) {
    console.warn('📱 Telegram DISABLED — TELEGRAM_CHAT_ID missing from env (token is set). Run: npm run telegram:setup');
    return;
  }
  // Shape validation — catch obvious typos before paying for an API round-trip
  if (token.includes('<') || token.includes('>')) {
    console.warn('📱 Telegram MISCONFIGURED — TELEGRAM_BOT_TOKEN contains <>. Replace the placeholder with your real token. Run: npm run telegram:setup');
    return;
  }
  if (/\s/.test(token)) {
    console.warn('📱 Telegram MISCONFIGURED — TELEGRAM_BOT_TOKEN contains whitespace. Run: npm run telegram:setup');
    return;
  }
  if (!token.includes(':') || token.length < 40) {
    console.warn(`📱 Telegram MISCONFIGURED — TELEGRAM_BOT_TOKEN looks malformed (${token.length} chars, has colon: ${token.includes(':')}). Run: npm run telegram:setup`);
    return;
  }
  // Healthy config — confirm visibly so debugging "did it fire?" is trivial
  console.log(`📱 Telegram ENABLED — chat_id ${chatId}, token …${token.slice(-6)} (will log every send)`);
}

/**
 * Send a single opportunity to Telegram. Fire-and-forget — failures are
 * logged but do NOT throw. The store push must never fail because Telegram
 * is down or misconfigured.
 */
export async function sendOpportunityToTelegram(opp: StoredOpportunity): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  // One-time banner on the first call — eliminates silent-no-op failure mode
  logConfigOnce(token, chatId);

  if (!token || !chatId) {
    // Logged once above; subsequent calls return silently to avoid log spam
    return;
  }

  // Production filter
  if (!TESTING_MODE) {
    const passes = opp.shouldAct || opp.viralityScore >= MIN_SCORE_TO_NOTIFY_PROD;
    if (!passes) {
      console.log(`📱 ↷ skip "${opp.topic.slice(0, 60)}" (score ${opp.viralityScore}, shouldAct ${opp.shouldAct}) — production filter`);
      return;
    }
  }

  const text = formatMessage(opp);
  const reply_markup = buildReplyMarkup(opp);

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true, // hide auto-link previews — buttons replace them
        ...(reply_markup ? { reply_markup } : {}),
      }),
      signal: AbortSignal.timeout(TELEGRAM_API_TIMEOUT_MS),
    });

    // Always read the body — Telegram returns structured errors as JSON
    const body: { ok?: boolean; error_code?: number; description?: string; result?: { message_id?: number } } =
      await res.json().catch(() => ({}));

    if (res.ok && body.ok !== false) {
      // Audible success — concise but enough to confirm delivery + which opp
      const msgId = (body as any).result?.message_id ?? '?';
      console.log(`📱 ✓ sent msg ${msgId} → chat ${chatId} "${opp.topic.slice(0, 60)}"`);
      return;
    }

    if (!res.ok || body.ok === false) {
      const code = body.error_code ?? res.status;
      const desc = body.description ?? 'unknown error';
      // Most actionable mappings — surface root cause, not a stack trace
      if (code === 401) {
        console.error(`📱 Telegram 401: ${desc}. Token rejected — re-check with: npm run telegram:setup`);
      } else if (code === 404) {
        console.error(`📱 Telegram 404: ${desc}. Token URL is malformed — usually a typo or placeholder text. Run: npm run telegram:setup`);
      } else if (code === 400 && desc.toLowerCase().includes('chat not found')) {
        console.error(`📱 Telegram 400: chat_id ${chatId} not found. Bot can't reach this chat. Run: npm run telegram:setup`);
      } else if (code === 429) {
        console.error(`📱 Telegram 429: rate limited. ${desc}`);
      } else {
        console.error(`📱 Telegram send failed (${code}): ${desc}`);
      }
    }
  } catch (err: any) {
    console.error(`📱 Telegram send error: ${err.message ?? err}`);
  }
}

/**
 * Format an opportunity as a Markdown Telegram message.
 *
 * The two X composer links live in the message body (not in the inline
 * keyboard) because Telegram's inline_keyboard.url field only accepts
 * http/https/tg:// — and we need the `twitter://` custom scheme to open
 * the native X app on mobile. Markdown `[label](url)` text links pass
 * arbitrary URL schemes through to the OS, which is the trick that makes
 * the native-app handoff work.
 *
 * On iOS/Android, tapping `[📱 Post on X (app)](twitter://post?message=...)`
 * hands the URL to the OS → X app opens with text pre-filled, no in-app
 * browser detour.
 *
 * The 🖼 Find image action stays in the inline keyboard (Google Images
 * is HTTPS so it works there, and it benefits from a larger tap target).
 */
function formatMessage(opp: StoredOpportunity): string {
  const safeTopic = sanitize(opp.topic);
  const safeDraft = sanitize(opp.draft);
  const safeReasoning = sanitize(opp.reasoning);
  const safeAngle = sanitize(opp.contentAngle);
  const safeImageQuery = sanitize(opp.imageSearchQuery);

  const fire = opp.shouldAct ? '🔥' : '🧪';
  const roi = opp.roiEstimate.toUpperCase();

  return [
    `${fire} *${safeTopic}*`,
    ``,
    `📊 Score: *${opp.viralityScore}/100*  |  Confidence: ${opp.confidence}%  |  ROI: ${roi}`,
    ``,
    safeAngle ? `🎯 _${safeAngle}_` : '',
    ``,
    `📝 *Draft (${opp.draft.length}/280)*`,
    safeDraft,
    ``,
    safeImageQuery ? `🖼 Image idea: _${safeImageQuery}_` : '',
    ``,
    safeReasoning ? `💭 ${safeReasoning}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * URL-encode for use inside a Markdown link `[label](url)` — same as
 * encodeURIComponent, plus explicit encoding of parens. encodeURIComponent
 * leaves `(` and `)` alone, but a literal `)` in the URL terminates the
 * Markdown link prematurely. Drafts often contain "(Q4 2026)" etc., so
 * this matters.
 */
function encodeForMarkdownUrl(text: string): string {
  return encodeURIComponent(text)
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

/**
 * Build the "Post on X" button URL.
 *
 * Telegram inline_keyboard URLs must be http/https/tg:// — custom schemes
 * like `twitter://` are rejected. AND Markdown text links can't smuggle a
 * custom scheme through either (Telegram strips them in all parse modes).
 *
 * So we use a 2-stage approach:
 *   1. Telegram sees an HTTPS URL → preserves it as a tappable button.
 *   2. The HTTPS URL points to our own /api/r/x route, which on mobile UAs
 *      returns HTML that fires `location.href = twitter://...` → the OS
 *      hands it to the X app. On desktop UAs it 302s straight to x.com.
 *
 * Requires the redirect route to be reachable from wherever the user taps
 * the button. Configured via VP_PUBLIC_BASE_URL env var:
 *   • Local desktop tests:  http://localhost:3000  (default)
 *   • Local phone testing:  http://192.168.x.x:3000 (your Mac's LAN IP)
 *   • Deployed (Vercel):    https://your-app.vercel.app
 *
 * If VP_PUBLIC_BASE_URL is not set OR the redirect route can't be reached,
 * we fall back to x.com/intent/post directly (works, but takes 2 taps on
 * mobile: Telegram in-app browser → x.com page → tap "Open in app" banner).
 */
function buildXButtonUrl(draftText: string): string {
  const base = process.env.VP_PUBLIC_BASE_URL?.replace(/\/$/, '');
  if (base && (base.startsWith('http://') || base.startsWith('https://'))) {
    // Smart redirect path — 1-tap to X app on mobile, 1-tap to web on desktop
    return `${base}/api/r/x?text=${encodeURIComponent(draftText)}`;
  }
  // No public base URL configured → fall back to direct web intent.
  // Still works, just takes 2 taps on mobile.
  return `https://x.com/intent/post?text=${encodeURIComponent(draftText)}`;
}

function buildGoogleImagesUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeForMarkdownUrl(query)}&tbm=isch`;
}

/**
 * Build the inline_keyboard — physical buttons under the message.
 *
 * Both buttons use HTTPS so Telegram preserves them. The Post-on-X button
 * routes through /api/r/x which serves a mobile-specific HTML page that
 * fires the twitter:// URL scheme → X app opens directly. Desktop UAs get
 * a 302 to the web composer. See app/api/r/x/route.ts.
 */
function buildReplyMarkup(opp: StoredOpportunity):
  | { inline_keyboard: Array<Array<{ text: string; url: string }>> }
  | undefined {
  const buttons: Array<{ text: string; url: string }> = [];
  if (opp.draft) {
    buttons.push({ text: '🚀 Post on X', url: buildXButtonUrl(opp.draft) });
  }
  if (opp.imageSearchQuery) {
    buttons.push({ text: '🖼 Find image', url: buildGoogleImagesUrl(opp.imageSearchQuery) });
  }
  if (buttons.length === 0) return undefined;
  return { inline_keyboard: [buttons] };
}

/**
 * Minimal Markdown safety pass. Telegram legacy Markdown only treats
 * *_`[ as control characters — escape those, leave everything else alone.
 * We do NOT escape inside links because the only link we use is a hardcoded
 * Google Search URL (no user content in the URL).
 */
function sanitize(s: string): string {
  if (!s) return '';
  return s.replace(/([*_`\[])/g, '\\$1');
}
