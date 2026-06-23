// src/scripts/run-galaxy04.ts
// Run with: npm run galaxy04
//
// Polls Google News across 6 categories once per hour, runs each story
// through Galaxy.04 (Haiku 4.5), and pushes approved drafts to the file
// store. The dashboard auto-displays them within 10 seconds.
//
// Cost: ~$0.02 per cycle × 24 cycles/day ≈ $0.53/day ≈ ~$16/month.
// No X API token required — Galaxy.04 uses Google News RSS only.
//
// Override the polling interval at launch:
//   POLL_INTERVAL=30 npm run galaxy04   # every 30 minutes
//   POLL_INTERVAL=120 npm run galaxy04  # every 2 hours

if (!process.env.VP_ANTHROPIC_KEY && !process.env.ANTHROPIC_API_KEY) {
  console.error('❌  No Anthropic API key — add VP_ANTHROPIC_KEY to .env.local');
  process.exit(1);
}

// Startup audit — print what this process can see, so stale env (process
// started before .env.local was updated) is obvious instead of silent.
console.log('🔧 run-galaxy04 startup environment audit:');
console.log(`   VP_ANTHROPIC_KEY:    ${process.env.VP_ANTHROPIC_KEY ? '✓ set' : '✗ MISSING'}`);
console.log(`   X_BEARER_TOKEN:      ${process.env.X_BEARER_TOKEN ? '✓ set' : '— not set (OK, Galaxy.04 doesn\'t need it)'}`);
console.log(`   TELEGRAM_BOT_TOKEN:  ${process.env.TELEGRAM_BOT_TOKEN ? '✓ set' : '✗ MISSING (no push notifications will fire)'}`);
console.log(`   TELEGRAM_CHAT_ID:    ${process.env.TELEGRAM_CHAT_ID ? '✓ set' : '✗ MISSING (no push notifications will fire)'}`);
console.log(`   → If anything you expect is MISSING, kill this process (Ctrl-C) and restart after editing .env.local.\n`);

import { Galaxy04 } from '@/galaxies/galaxy.04';
import { UserPreferences } from '@/shared/types';

const USER_PREFS: UserPreferences = {
  userId: 'galaxy04-bg',
  mode: 'pure_growth',
  aggressiveness: 7,
  weeklyFollowerTarget: 1000,
  niches: ['breaking news', 'politics', 'technology', 'AI', 'business', 'sports', 'entertainment'],
};

const POLL_INTERVAL_MINUTES = Number(process.env.POLL_INTERVAL ?? 60);

const galaxy = new Galaxy04();

process.on('SIGINT', () => {
  galaxy.stop();
  process.exit(0);
});

galaxy
  .start({
    userPrefs: USER_PREFS,
    intervalMinutes: POLL_INTERVAL_MINUTES,
    // Defaults from index.ts are used for categories/perCategoryFetch/
    // perCategoryPick/maxStories — override here if you want to rebalance.
  })
  .catch((err) => {
    console.error('💥  Fatal:', err.message);
    process.exit(1);
  });
