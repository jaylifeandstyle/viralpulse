// src/scripts/test-galaxy05.ts
// Run with: npm run test:galaxy05
//
// One Galaxy.05 cycle: BBC + X Trends + Haiku. No store push, no auto-post.

if (!process.env.VP_ANTHROPIC_KEY && !process.env.ANTHROPIC_API_KEY) {
  console.error('❌ No Anthropic API key — add VP_ANTHROPIC_KEY to .env.local');
  process.exit(1);
}

import { Galaxy05 } from '@/galaxies/galaxy.05';

const userPrefs = {
  userId: 'test-journalist',
  mode: 'pure_growth' as const,
  aggressiveness: 7,
  weeklyFollowerTarget: 1000,
  niches: ['breaking news', 'politics', 'technology', 'business', 'entertainment'],
};

(async () => {
  const galaxy = new Galaxy05();
  const opps = await galaxy.runHybridAnalysis({
    userPrefs,
    pushToStore: false,
    autoPost: false,
  });

  console.log(`\n═══════════════════════════════════════════`);
  console.log(`Got ${opps.length} opportunit${opps.length === 1 ? 'y' : 'ies'}\n`);
  for (const o of opps) {
    const variant = o.galaxyVariant ? ` [${o.galaxyVariant}]` : '';
    console.log(`[${o.viralityScore}/100  conf:${o.confidence}%  shouldAct:${o.shouldAct}]${variant}`);
    console.log(`  ${o.topic.slice(0, 80)}`);
    console.log(`  ${o.draft.replace(/\n/g, '\n  ')}`);
    if (o.imageUrl) console.log(`  🖼 RSS image: ${o.imageUrl.slice(0, 60)}…`);
    console.log(`  📷 ${o.imageSearchQuery}\n`);
  }
})().catch((err) => {
  console.error('\n❌ Test failed:', err.message);
  process.exit(1);
});
