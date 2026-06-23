// src/scripts/run-galaxy05.ts
// Run with: npm run galaxy05
//
// Hybrid early-mover: X Trends-first + Google News anchor + optional auto-post.
// NOT Galaxy.04 — does not pull BBC RSS.
//
// Auto-post (opt-in):
//   VP_AUTO_POST=true
//   X_ACCESS_TOKEN + X_ACCESS_TOKEN_SECRET (+ X_CLIENT_ID/SECRET)
//
// Override polling:
//   POLL_INTERVAL=60 npm run galaxy05

if (!process.env.VP_ANTHROPIC_KEY && !process.env.ANTHROPIC_API_KEY) {
  console.error('❌  No Anthropic API key — add VP_ANTHROPIC_KEY to .env.local');
  process.exit(1);
}

console.log('🔧 run-galaxy05 startup environment audit:');
console.log(`   VP_ANTHROPIC_KEY:    ${process.env.VP_ANTHROPIC_KEY ? '✓ set' : '✗ MISSING'}`);
console.log(`   X_BEARER_TOKEN:      ${process.env.X_BEARER_TOKEN ? '✓ set' : '✗ MISSING (trends will be skipped)'}`);
console.log(`   VP_AUTO_POST:        ${process.env.VP_AUTO_POST === 'true' ? '✓ ENABLED' : '— off (set VP_AUTO_POST=true to auto-post)'}`);
console.log(`   X posting creds:     ${process.env.X_ACCESS_TOKEN && process.env.X_ACCESS_TOKEN_SECRET ? '✓ set' : '— not set (auto-post needs OAuth tokens)'}`);
console.log(`   TELEGRAM_BOT_TOKEN:  ${process.env.TELEGRAM_BOT_TOKEN ? '✓ set' : '— optional'}`);
console.log(`   TELEGRAM_CHAT_ID:    ${process.env.TELEGRAM_CHAT_ID ? '✓ set' : '— optional'}\n`);

import { Galaxy05 } from '@/galaxies/galaxy.05';
import { UserPreferences } from '@/shared/types';

const USER_PREFS: UserPreferences = {
  userId: 'galaxy05-bg',
  mode: 'pure_growth',
  aggressiveness: 7,
  weeklyFollowerTarget: 1000,
  niches: ['breaking news', 'politics', 'technology', 'business', 'entertainment'],
};

const POLL_INTERVAL_MINUTES = Number(process.env.POLL_INTERVAL ?? 60);
const AUTO_POST = process.env.VP_AUTO_POST !== 'false';

const galaxy = new Galaxy05();

process.on('SIGINT', () => {
  galaxy.stop();
  process.exit(0);
});

galaxy
  .start({
    userPrefs: USER_PREFS,
    intervalMinutes: POLL_INTERVAL_MINUTES,
    autoPost: AUTO_POST,
  })
  .catch((err) => {
    console.error('💥  Fatal:', err.message);
    process.exit(1);
  });
