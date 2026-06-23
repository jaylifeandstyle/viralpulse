// src/scripts/test-galaxy02.ts
// .env.local is loaded automatically via: tsx --env-file=.env.local
// Run with: npm run test:galaxy02

if (!process.env.VP_ANTHROPIC_KEY && !process.env.ANTHROPIC_API_KEY) {
  console.error('❌ No Anthropic API key found.');
  console.error('   Make sure .env.local exists in the project root and contains:');
  console.error('   VP_ANTHROPIC_KEY=sk-ant-...');
  console.error('   Then run:  npm run test:galaxy02');
  process.exit(1);
}

import { brain } from '@/brain';

async function testGalaxy02() {
  console.log('🧪 Testing Galaxy.02 (Smart Selective Strategy)...\n');

  const testSignals = {
    topic: 'Apple announces new AI feature',
    velocity: 180,
    acceleration: 95,
    avgEngagement: 850,
    trending: false,
    samplePosts: [],
    timestamp: new Date(),
  };

  const userPrefs = {
    userId: 'test-user',
    mode: 'pure_growth' as const,
    aggressiveness: 7,
    weeklyFollowerTarget: 800,
    niches: ['technology', 'news'],
  };

  const result = await brain.processOpportunity(testSignals, userPrefs);

  console.log('Galaxy.02 Response:');
  console.log(JSON.stringify(result, null, 2));
}

testGalaxy02().catch((err) => {
  console.error('\n❌ Test failed:', err.message);
  process.exit(1);
});
