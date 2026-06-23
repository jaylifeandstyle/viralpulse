// src/scripts/telegram-setup.ts
// Run with: npm run telegram:setup
//
// Diagnoses common Telegram bot setup problems and (when TELEGRAM_CHAT_ID
// is set) sends a test message to confirm the full pipeline works.
//
// What this script catches that the manual setup flow misses:
//   1. Forgetting to replace <TOKEN> in the URL → "Token contains placeholder text"
//   2. Pasting token with whitespace / quotes → "Token has invalid whitespace"
//   3. Token rejected by Telegram → "401 — re-check token from @BotFather"
//   4. No messages sent to bot yet → clear instruction to do so
//   5. Multiple chats in getUpdates → shows all candidates so you pick the right one

const TELEGRAM_API_BASE = 'https://api.telegram.org';

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
};

type BotInfo = { id: number; username: string; first_name: string };

type Update = {
  update_id: number;
  message?: {
    chat: { id: number; type: string; title?: string; first_name?: string; username?: string };
    text?: string;
  };
};

async function main(): Promise<void> {
  console.log('🤖 ViralPulse — Telegram setup diagnosis\n');

  // ─── Step 1: read & validate token ────────────────────────────────────
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    fail(
      'TELEGRAM_BOT_TOKEN is not set in .env.local',
      [
        'Open Telegram → message @BotFather → /newbot',
        'Save the token it gives you (looks like 1234567890:AAE...)',
        'Add to .env.local:  TELEGRAM_BOT_TOKEN=1234567890:AAE...',
        'Re-run: npm run telegram:setup',
      ],
    );
  }

  const tokenIssue = validateTokenShape(token);
  if (tokenIssue) fail(`Token format problem: ${tokenIssue}`, [
    'A valid token looks like:  1234567890:AAEhBP0av1nFw9DjU7ZGSzlYLcUmtGTzWnY',
    '  • numeric bot ID  →  colon  →  35+ alphanumeric/underscore/hyphen chars',
    '  • no angle brackets, no quotes, no whitespace',
    'Get a fresh token from @BotFather → /mybots → your bot → API Token',
  ]);

  console.log(`✓ Token shape looks valid  (length=${token.length})\n`);

  // ─── Step 2: call getMe → verify token works against Telegram ─────────
  console.log('🔍 Verifying token with Telegram (getMe)…');
  const me = await call<BotInfo>(token, 'getMe');
  if (!me.ok) {
    if (me.error_code === 401) {
      fail(
        `Telegram rejected the token (401 Unauthorized)`,
        [
          `Telegram's response: "${me.description ?? 'no description'}"`,
          'This means the token is wrong, revoked, or for a different bot.',
          'Fix: @BotFather → /mybots → pick your bot → API Token → copy fresh value',
        ],
      );
    }
    if (me.error_code === 404) {
      fail(
        `Telegram returned 404 — URL path issue`,
        [
          'This is the same error you saw in the browser. The /bot prefix in the',
          'URL is REQUIRED and gets prepended automatically by this script.',
          'If you see this here, the token itself is malformed.',
          `Token preview: ${token.slice(0, 12)}…${token.slice(-4)}`,
        ],
      );
    }
    fail(`Telegram API error (${me.error_code}): ${me.description ?? 'unknown'}`, []);
  }
  console.log(`✓ Token works — bot is @${me.result!.username} (id ${me.result!.id})\n`);

  // ─── Step 3: getUpdates → find chat_id ────────────────────────────────
  console.log('🔍 Looking for chats that have messaged your bot (getUpdates)…');
  const updates = await call<Update[]>(token, 'getUpdates');
  if (!updates.ok) {
    fail(`getUpdates failed (${updates.error_code}): ${updates.description ?? 'unknown'}`, []);
  }

  const chats = new Map<number, { type: string; label: string }>();
  for (const u of updates.result!) {
    if (u.message?.chat) {
      const c = u.message.chat;
      const label = c.title ?? c.username ?? c.first_name ?? `chat ${c.id}`;
      chats.set(c.id, { type: c.type, label });
    }
  }

  if (chats.size === 0) {
    console.log('⚠️  No messages found in getUpdates.\n');
    console.log('   This is expected if you haven\'t messaged the bot yet.');
    console.log('   Action:');
    console.log(`     1. Open Telegram, search for @${me.result!.username}`);
    console.log('     2. Send it any message (e.g. "hi")');
    console.log('     3. Re-run:  npm run telegram:setup\n');
    process.exit(0);
  }

  console.log(`✓ Found ${chats.size} chat${chats.size === 1 ? '' : 's'} that messaged your bot:\n`);
  for (const [id, info] of chats) {
    console.log(`   chat_id ${id}  [${info.type}]  ${info.label}`);
  }

  const expectedChatId = process.env.TELEGRAM_CHAT_ID;

  if (!expectedChatId) {
    const [firstId] = chats.keys();
    console.log('\n📋 Next step:');
    console.log(`   Add to .env.local:  TELEGRAM_CHAT_ID=${firstId}`);
    console.log('   Then re-run this script — it\'ll send a test message to confirm.\n');
    process.exit(0);
  }

  // ─── Step 4: send a real test message ────────────────────────────────
  console.log(`\n📤 Sending test message to chat_id ${expectedChatId}…`);
  const sent = await call<{ message_id: number }>(token, 'sendMessage', {
    chat_id: expectedChatId,
    text:
      '✅ *ViralPulse setup confirmed*\n\n' +
      'Your bot is wired up. Opportunities pushed by Galaxy.03 / Galaxy.04 ' +
      'will now arrive here automatically.\n\n' +
      '_(This message was sent by npm run telegram:setup)_',
    parse_mode: 'Markdown',
  });

  if (!sent.ok) {
    if (sent.error_code === 400 && sent.description?.includes('chat not found')) {
      fail(
        `Telegram says "chat not found" for chat_id ${expectedChatId}`,
        [
          'The chat_id in .env.local doesn\'t match any chat your bot can reach.',
          'From the list above, pick the chat_id you actually want and update .env.local.',
          'If you want the bot to message a group, add the bot to the group first',
          'and send a message in the group so it appears in getUpdates.',
        ],
      );
    }
    fail(`sendMessage failed (${sent.error_code}): ${sent.description ?? 'unknown'}`, []);
  }

  console.log(`✓ Test message delivered — check your Telegram!`);
  console.log(`  (message_id ${sent.result!.message_id})\n`);
  console.log('🎉 You\'re done. Real opportunities will start arriving the next time a galaxy pushes one.');
}

// ─── Helpers ───────────────────────────────────────────────────────────

function validateTokenShape(token: string): string | null {
  if (token.includes('<') || token.includes('>')) return 'contains angle brackets — replace <TOKEN> placeholder with real token';
  if (/\s/.test(token)) return 'contains whitespace — strip spaces/newlines';
  if (token.startsWith('"') || token.endsWith('"')) return 'has surrounding quotes — strip them';
  if (token.startsWith('bot')) return 'starts with "bot" — that prefix belongs in the URL, not the token itself';
  if (!token.includes(':')) return 'missing the colon separator (real tokens look like 12345:ABC...)';
  if (token.length < 40) return `too short (${token.length} chars; real tokens are ~46)`;
  const [botId, secret] = token.split(':');
  if (!/^\d+$/.test(botId)) return 'bot id (before the colon) should be all digits';
  if (secret.length < 30) return 'secret part (after the colon) is too short';
  return null;
}

async function call<T>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<TelegramApiResponse<T>> {
  const url = `${TELEGRAM_API_BASE}/bot${token}/${method}`;
  try {
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    return (await res.json()) as TelegramApiResponse<T>;
  } catch (err: any) {
    return {
      ok: false,
      error_code: 0,
      description: `network error: ${err.message ?? err}`,
    };
  }
}

function fail(headline: string, hints: string[]): never {
  console.error(`\n❌ ${headline}\n`);
  for (const h of hints) console.error(`   ${h}`);
  console.error('');
  process.exit(1);
}

main().catch((err) => {
  console.error('\n💥 Setup script crashed:', err);
  process.exit(1);
});
