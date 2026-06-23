// src/scripts/test-galaxy03.ts
// Run with: npm run test:galaxy03
//
// Safe, low-cost test:
//   • Test 1: One Haiku call against a hand-crafted trend signal.
//     Cost: ~$0.004. No X API call. Always runs.
//   • Test 2: Live X Trends fetch, but pushToStore=false and maxTrends=2,
//     so worst case ~$0.008 + 1 X API call. Skipped if X tier blocks it.

if (!process.env.VP_ANTHROPIC_KEY && !process.env.ANTHROPIC_API_KEY) {
  console.error('❌ No Anthropic API key — add VP_ANTHROPIC_KEY to .env.local');
  process.exit(1);
}

import { Galaxy03 } from '@/galaxies/galaxy.03';
import { brain } from '@/brain';

const userPrefs = {
  userId: 'test-journalist',
  mode: 'pure_growth' as const,
  aggressiveness: 7,
  weeklyFollowerTarget: 1000,
  niches: ['breaking news', 'politics', 'technology', 'business'],
};

// ---------------------------------------------------------------------------
// Test 1 — one analysis call, no X API
// ---------------------------------------------------------------------------
async function testProcessOpportunity() {
  console.log('\n🧪 Test 1: processOpportunity() — 1 Haiku call, ~$0.004\n');
  brain.setActiveGalaxy('galaxy.03');

  // A plausible real-world trend the model can reason about
  const signals = {
    topic: '#OpenAI',
    velocity: 2200,
    acceleration: 0,
    avgEngagement: 132_000,
    trending: true,
    samplePosts: [],
    timestamp: new Date(),
  };

  const result = await brain.processOpportunity(signals, userPrefs);
  console.log(JSON.stringify(result, null, 2));
  console.log(`\n  Draft char count: ${(result.draftTweet ?? '').length}/280`);
  console.log(`  shouldAct: ${result.shouldAct}   optimalPostTime: ${result.optimalPostTime}`);
}

// ---------------------------------------------------------------------------
// Test 2 — live Trends API + analysis (small, no store push)
// ---------------------------------------------------------------------------
async function testTrendsAnalysis() {
  if (!process.env.X_BEARER_TOKEN) {
    console.log('\n⚠️  Skipping Test 2 — X_BEARER_TOKEN not set\n');
    return;
  }
  console.log('\n🧪 Test 2: runTrendsAnalysis() — live X Trends, max 2 analyses, ~$0.008\n');

  const galaxy = new Galaxy03();
  try {
    const opps = await galaxy.runTrendsAnalysis({
      userPrefs,
      woeid: 1,
      maxTrends: 5,         // 5 candidates × Haiku ≈ $0.02
      minVolume: 0,         // No volume floor — v2 often returns 0 even on real trends
      pushToStore: false,   // Don't pollute the dashboard during testing
    });
    console.log(`\n✅ Got ${opps.length} approved opportunit${opps.length === 1 ? 'y' : 'ies'}`);
    for (const o of opps) {
      console.log(`\n[${o.viralityScore}/100] ${o.topic}`);
      console.log(`  ${o.draft.replace(/\n/g, '\n  ')}`);
      console.log(`  📷 ${o.imageSearchQuery}`);
    }
  } catch (err: any) {
    console.error(`\n❌ Trends fetch failed: ${err.message}`);
    console.log('   (Expected on Free X tier — v1.1 trends needs Basic+)');
  }
}

(async () => {
  await testProcessOpportunity();
  await testTrendsAnalysis();
})().catch((err) => {
  console.error('\n❌ Test runner failed:', err.message);
  process.exit(1);
});
