// src/scripts/run-galaxy05.ts
// Run with: npm run galaxy05
//
// Galaxy.05 sub-variants (GALAXY_05_VARIANT):
//   05.02 — X trends-first (default)
//   05.01 — BBC + X hybrid (archived, overlaps G04)
//
// Auto-post: VP_AUTO_POST=true + OAuth creds
// Polling:   POLL_INTERVAL=60 npm run galaxy05

import { Galaxy05, DEFAULT_GALAXY_05_VARIANT } from '@/galaxies/galaxy.05';
import { UserPreferences } from '@/shared/types';

if (!process.env.VP_ANTHROPIC_KEY && !process.env.ANTHROPIC_API_KEY) {
  console.error('❌  No Anthropic API key — add VP_ANTHROPIC_KEY to .env.local');
  process.exit(1);
}

console.log('🔧 run-galaxy05 startup environment audit:');
console.log(`   VP_ANTHROPIC_KEY:    ${process.env.VP_ANTHROPIC_KEY ? '✓ set' : '✗ MISSING'}`);
console.log(`   X_BEARER_TOKEN:      ${process.env.X_BEARER_TOKEN ? '✓ set' : '✗ MISSING'}`);
console.log(`   GALAXY_05_VARIANT:   ${process.env.GALAXY_05_VARIANT ?? `(default ${DEFAULT_GALAXY_05_VARIANT})`}`);
console.log(`   VP_AUTO_POST:        ${process.env.VP_AUTO_POST === 'true' ? '✓ ENABLED' : '— off'}`);
console.log(`   X posting creds:     ${process.env.X_ACCESS_TOKEN && process.env.X_ACCESS_TOKEN_SECRET ? '✓ set' : '— not set'}`);
console.log(`   TELEGRAM_BOT_TOKEN:  ${process.env.TELEGRAM_BOT_TOKEN ? '✓ set' : '— optional'}`);
console.log(`   TELEGRAM_CHAT_ID:    ${process.env.TELEGRAM_CHAT_ID ? '✓ set' : '— optional'}\n`);

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
