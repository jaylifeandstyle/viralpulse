// src/scripts/run-galaxy03.ts
// Run with: npm run galaxy03
//
// Polls X Trends API once per hour, runs each candidate through Galaxy.03,
// and pushes approved opportunities to the file store. The dashboard auto-
// displays them.
//
// Cost: ~$0.02 per cycle × 24 cycles/day ≈ $0.48/day on Haiku 4.5.
// Plus 1 X API call/hour (well under the 75/15min limit on Basic tier).

if (!process.env.X_BEARER_TOKEN) {
  console.error('❌  X_BEARER_TOKEN is not set in .env.local');
  process.exit(1);
}

if (!process.env.VP_ANTHROPIC_KEY && !process.env.ANTHROPIC_API_KEY) {
  console.error('❌  No Anthropic API key — add VP_ANTHROPIC_KEY to .env.local');
  process.exit(1);
}

// Startup audit — print what this process sees, so stale env is obvious.
console.log('🔧 run-galaxy03 startup environment audit:');
console.log(`   VP_ANTHROPIC_KEY:    ${process.env.VP_ANTHROPIC_KEY ? '✓ set' : '✗ MISSING'}`);
console.log(`   X_BEARER_TOKEN:      ${process.env.X_BEARER_TOKEN ? '✓ set' : '✗ MISSING (Galaxy.03 needs this)'}`);
console.log(`   TELEGRAM_BOT_TOKEN:  ${process.env.TELEGRAM_BOT_TOKEN ? '✓ set' : '✗ MISSING (no push notifications will fire)'}`);
console.log(`   TELEGRAM_CHAT_ID:    ${process.env.TELEGRAM_CHAT_ID ? '✓ set' : '✗ MISSING (no push notifications will fire)'}`);
console.log(`   → If anything you expect is MISSING, kill this process (Ctrl-C) and restart after editing .env.local.\n`);

import { Galaxy03 } from '@/galaxies/galaxy.03';
import { UserPreferences } from '@/shared/types';

const USER_PREFS: UserPreferences = {
  userId: 'galaxy03-bg',
  mode: 'pure_growth',
  aggressiveness: 7,
  weeklyFollowerTarget: 1000,
  niches: ['breaking news', 'politics', 'technology', 'AI', 'business'],
};

const POLL_INTERVAL_MINUTES = 60;
const WOEID = 1; // Worldwide. Override with: WOEID=23424977 npm run galaxy03 (USA)
const MAX_TRENDS = 5;
const MIN_VOLUME = 10_000;

const galaxy = new Galaxy03();

process.on('SIGINT', () => {
  galaxy.stop();
  process.exit(0);
});

galaxy
  .start({
    userPrefs: USER_PREFS,
    intervalMinutes: POLL_INTERVAL_MINUTES,
    woeid: Number(process.env.WOEID ?? WOEID),
    maxTrends: MAX_TRENDS,
    minVolume: MIN_VOLUME,
  })
  .catch((err) => {
    console.error('💥  Fatal:', err.message);
    process.exit(1);
  });
