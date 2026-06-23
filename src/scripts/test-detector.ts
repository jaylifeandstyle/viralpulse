// src/scripts/test-detector.ts
// .env.local is loaded automatically by the npm script via:
//   tsx --env-file=.env.local src/scripts/test-detector.ts

import { viralityDetector } from '@/lib/virality-detector';

const TEST_USER = 'test-user';
const TEST_NICHES = ['Apple', 'AI', 'Trump', 'Elon Musk', 'breaking news'];

function checkEnv() {
  if (!process.env.X_BEARER_TOKEN) {
    console.error('❌ X_BEARER_TOKEN is not set.');
    console.error('   Make sure .env.local exists in the project root and contains:');
    console.error('   X_BEARER_TOKEN=AAAA...');
    console.error('   Then run:  npm run test:detector');
    process.exit(1);
  }
  console.log('✅ X_BEARER_TOKEN loaded.\n');
}

async function testDetector() {
  console.log('🧪 Virality Detector Test\n');

  checkEnv();

  // Step 1: Register rules on X's API.
  // This must succeed before start() is called — start() verifies
  // rules exist server-side and throws 409 if none are found.
  console.log('Step 1/2 — Registering monitoring rules...');
  await viralityDetector.addMonitoringRules(TEST_USER, TEST_NICHES);

  // Step 2: Open the filtered stream.
  // Returns only when the stream closes (Ctrl+C, error, or X disconnect).
  console.log('\nStep 2/2 — Starting stream...\n');
  await viralityDetector.start();

  console.log('\nStream ended.');
}

process.on('SIGINT', () => {
  console.log('\nCtrl+C received — stopping...');
  viralityDetector.stop();
  process.exit(0);
});

testDetector().catch((err) => {
  console.error('\n❌ Test failed:', err.message);
  process.exit(1);
});
