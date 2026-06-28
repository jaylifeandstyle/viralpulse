/**
 * src/scripts/backfill-posts.ts
 *
 * Imports past tweets into the profile feed by tweet ID. For each ID,
 * fetches public data (text, author, posted-at, engagement metrics)
 * from the X syndication CDN — free, no paid API needed — and writes
 * a StoredPost.
 *
 * Usage:
 *   npm run backfill:posts -- 1234567890 0987654321
 *   npm run backfill:posts -- $(cat tweet-ids.txt)
 *
 * Notes:
 * - The handle on each post is VP_OWNER_HANDLE.
 * - Already-present tweet IDs are deduped silently by the post store.
 * - Tweets not in the syndication CDN (deleted / suspended / too new)
 *   are reported and skipped, not fatal.
 */

import { fetchTweetSyndication } from '@/lib/x-syndication';
import { savePost } from '@/store/post-store';

async function main() {
  const ids = process.argv.slice(2).map((s) => s.trim()).filter(Boolean);
  if (!ids.length) {
    console.error('Pass one or more tweet IDs as arguments.');
    console.error('Example: npm run backfill:posts -- 1234567890 0987654321');
    process.exit(1);
  }

  const handle = (process.env.VP_OWNER_HANDLE ?? 'jay').toLowerCase();
  let saved = 0;
  let skipped = 0;

  for (const id of ids) {
    const tweet = await fetchTweetSyndication(id);
    if (!tweet) {
      console.warn(`✗ ${id}  not found in syndication CDN — skipped`);
      skipped++;
      continue;
    }
    await savePost({
      tweetId: tweet.id,
      handle,
      text: tweet.text,
      postedAt: tweet.createdAt,
      xStats: {
        favoriteCount: tweet.favoriteCount,
        retweetCount: tweet.retweetCount,
        replyCount: tweet.replyCount,
        capturedAt: new Date().toISOString(),
      },
    });
    console.log(
      `✓ ${id}  ${tweet.favoriteCount} likes · ${tweet.replyCount} replies — "${tweet.text.slice(0, 60).replace(/\s+/g, ' ')}…"`,
    );
    saved++;
  }

  console.log(`\nDone — ${saved} saved, ${skipped} skipped.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
