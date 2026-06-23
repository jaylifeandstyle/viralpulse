// src/scripts/run-detector.ts
// Run with: npm run detect
// .env.local is loaded automatically by the npm script.

if (!process.env.X_BEARER_TOKEN) {
  console.error('❌  X_BEARER_TOKEN is not set.');
  console.error('    Make sure .env.local exists and contains X_BEARER_TOKEN=...');
  console.error('    Then run: npm run detect');
  process.exit(1);
}

if (!process.env.VP_ANTHROPIC_KEY && !process.env.ANTHROPIC_API_KEY) {
  console.error('❌  No Anthropic API key found.');
  console.error('    Make sure .env.local exists and contains VP_ANTHROPIC_KEY=sk-ant-...');
  console.error('    Then run: npm run detect');
  process.exit(1);
}

import { LowCostDetector } from '@/lib/low-cost-detector';

const POLL_INTERVAL_MINUTES = 20;

const detector = new LowCostDetector();

process.on('SIGINT', () => {
  console.log('\n🛑  Detector stopped.');
  process.exit(0);
});

detector.start(POLL_INTERVAL_MINUTES).catch((err) => {
  console.error('💥  Fatal error:', err.message);
  process.exit(1);
});
