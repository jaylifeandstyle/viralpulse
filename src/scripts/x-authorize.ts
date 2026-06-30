/**
 * src/scripts/x-authorize.ts
 *
 * One-time OAuth 1.0a authorization to obtain Access Token + Secret for a
 * SECOND X account (e.g. @ViralPulseX_AI) using your existing developer
 * app's consumer keys (X_CLIENT_ID / X_CLIENT_SECRET).
 *
 * PIN-based (out-of-band) flow — no callback server needed:
 *   1. Run: npm run x:authorize
 *   2. Open the printed URL while logged in as the TARGET account
 *   3. Approve — X shows a PIN
 *   4. Paste the PIN back here
 *   5. Copy the printed tokens into .env.local + Vercel
 *
 * If the app is Read-only, the URL step or login will surface an error,
 * or the issued token will fail to post later with a 403 — in that case
 * flip the app to "Read and write" in the X developer portal and
 * regenerate.
 */

import { TwitterApi } from 'twitter-api-v2';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

async function main() {
  const appKey = process.env.X_CLIENT_ID;
  const appSecret = process.env.X_CLIENT_SECRET;
  if (!appKey || !appSecret) {
    console.error('❌ Missing X_CLIENT_ID / X_CLIENT_SECRET in .env.local');
    process.exit(1);
  }

  const client = new TwitterApi({ appKey, appSecret });

  let authLink;
  try {
    authLink = await client.generateAuthLink('oob', { authAccessType: 'write' });
  } catch (err) {
    console.error(
      '\n❌ Could not start authorization. Common causes: wrong consumer keys, ' +
        'or the app does not allow OAuth 1.0a. Details:\n',
    );
    console.error(err);
    process.exit(1);
  }

  console.log('\n────────────────────────────────────────────────────────');
  console.log('STEP 1 — open this URL in a browser logged in as the');
  console.log('         account you want to authorize (e.g. @ViralPulseX_AI):\n');
  console.log('   ' + authLink.url + '\n');
  console.log('STEP 2 — click Authorize. X will show you a 7-digit PIN.');
  console.log('────────────────────────────────────────────────────────\n');

  const rl = readline.createInterface({ input, output });
  const pin = (await rl.question('STEP 3 — paste the PIN here: ')).trim();
  rl.close();

  if (!pin) {
    console.error('❌ No PIN entered.');
    process.exit(1);
  }

  const tempClient = new TwitterApi({
    appKey,
    appSecret,
    accessToken: authLink.oauth_token,
    accessSecret: authLink.oauth_token_secret,
  });

  try {
    const { accessToken, accessSecret, screenName } = await tempClient.login(pin);
    console.log('\n✓ Authorized as @' + screenName + '\n');
    console.log('Add these to .env.local AND Vercel (Production scope):\n');
    console.log(`  # @${screenName}`);
    console.log(`  X_BRAND_ACCESS_TOKEN=${accessToken}`);
    console.log(`  X_BRAND_ACCESS_TOKEN_SECRET=${accessSecret}`);
    console.log(
      '\n(If you authorized your PERSONAL account by mistake, re-run and log in ' +
        'as the brand account instead.)\n',
    );
  } catch (err) {
    console.error(
      '\n❌ Login failed. The PIN may be wrong or expired (they are single-use), ' +
        'or the app is Read-only. Try again, or check the app permissions.\n',
    );
    console.error(err);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
