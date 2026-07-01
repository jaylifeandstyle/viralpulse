// src/scripts/run-galaxy07.ts
// Run with: npm run galaxy07
//
// Cross-platform Pure Growth fusion. Manual Post Now only — no auto-post.

import { Galaxy07 } from '@/galaxies/galaxy.07';
import { UserPreferences } from '@/shared/types';

if (!process.env.VP_ANTHROPIC_KEY && !process.env.ANTHROPIC_API_KEY) {
  console.error('❌  No Anthropic API key — add VP_ANTHROPIC_KEY to .env.local');
  process.exit(1);
}

console.log('🔧 run-galaxy07 startup audit:');
console.log(`   VP_ANTHROPIC_KEY:    ${process.env.VP_ANTHROPIC_KEY ? '✓' : '✗ MISSING'}`);
console.log(`   YOUTUBE_API_KEY:     ${process.env.YOUTUBE_API_KEY ? '✓' : '— optional'}`);
console.log(`   X_BEARER_TOKEN:      ${process.env.X_BEARER_TOKEN ? '✓' : '— optional'}`);
console.log(`   Auto-post:           DISABLED for Galaxy.07 (manual only)\n`);

const USER_PREFS: UserPreferences = {
  userId: 'galaxy07-bg',
  mode: 'pure_growth',
  aggressiveness: 9,
  weeklyFollowerTarget: 2000,
  niches: ['viral', 'memes', 'tech', 'drama', 'culture', 'AI'],
};

const POLL_INTERVAL_MINUTES = Number(process.env.POLL_INTERVAL ?? 60);
const galaxy = new Galaxy07();

process.on('SIGINT', () => {
  galaxy.stop();
  process.exit(0);
});

galaxy
  .start({
    userPrefs: USER_PREFS,
    intervalMinutes: POLL_INTERVAL_MINUTES,
  })
  .catch((err) => {
    console.error('💥  Fatal:', err.message);
    process.exit(1);
  });
