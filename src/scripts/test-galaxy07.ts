// src/scripts/test-galaxy07.ts
// Run with: npm run test:galaxy07

import { Galaxy07 } from '@/galaxies/galaxy.07';

const userPrefs = {
  userId: 'test-growth',
  mode: 'pure_growth' as const,
  aggressiveness: 9,
  weeklyFollowerTarget: 2000,
  niches: ['viral', 'tech', 'memes'],
};

(async () => {
  const galaxy = new Galaxy07();
  const opps = await galaxy.runFusionAnalysis({
    userPrefs,
    pushToStore: false,
    includeXTrends: !!process.env.X_BEARER_TOKEN,
  });

  console.log(`\n═══════════════════════════════════════════`);
  console.log(`Got ${opps.length} opportunit${opps.length === 1 ? 'y' : 'ies'}\n`);
  for (const o of opps) {
    console.log(`[${o.viralityScore}/100] ${o.topic.slice(0, 70)}`);
    if (o.imageUrls?.length) console.log(`  🖼 images: ${o.imageUrls.join(' | ')}`);
    if (o.videoUrl) console.log(`  🎬 video: ${o.videoUrl}`);
    console.log(`  ${o.draft.replace(/\n/g, '\n  ')}\n`);
  }
})().catch((err) => {
  console.error('\n❌ Test failed:', err.message);
  process.exit(1);
});
