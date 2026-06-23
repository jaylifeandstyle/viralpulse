// src/scripts/test-galaxy04.ts
// Run with: npm run test:galaxy04
//
// One full Galaxy.04 cycle against live Google News.
// Cost: ~$0.02–0.03 (6 categories × ~$0.004 Haiku each).
// No X API calls — Galaxy.04 doesn't use Twitter at all.

if (!process.env.VP_ANTHROPIC_KEY && !process.env.ANTHROPIC_API_KEY) {
  console.error('❌ No Anthropic API key — add VP_ANTHROPIC_KEY to .env.local');
  process.exit(1);
}

import { Galaxy04 } from '@/galaxies/galaxy.04';

const userPrefs = {
  userId: 'test-journalist',
  mode: 'pure_growth' as const,
  aggressiveness: 7,
  weeklyFollowerTarget: 1000,
  niches: ['breaking news', 'politics', 'technology', 'business', 'sports', 'entertainment'],
};

(async () => {
  const galaxy = new Galaxy04();
  const opps = await galaxy.runNewsAnalysis({
    userPrefs,
    pushToStore: false, // Don't pollute dashboard during testing
  });

  console.log(`\n═══════════════════════════════════════════`);
  console.log(`Got ${opps.length} approved opportunit${opps.length === 1 ? 'y' : 'ies'}\n`);
  for (const o of opps) {
    console.log(`[${o.viralityScore}/100  conf:${o.confidence}%]  ${o.topic.slice(0, 80)}`);
    console.log(`  ${o.draft.replace(/\n/g, '\n  ')}`);
    console.log(`  📷 ${o.imageSearchQuery}\n`);
  }
})().catch((err) => {
  console.error('\n❌ Test failed:', err.message);
  process.exit(1);
});
