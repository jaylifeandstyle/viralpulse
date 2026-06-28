/**
 * src/lib/x-syndication.ts
 *
 * Calls X's public syndication CDN (cdn.syndication.twimg.com) — the same
 * endpoint that powers the official embed widget and react-tweet. Free,
 * unauthenticated, no API key required.
 *
 * Caveat — newly-posted tweets typically take ~30-60 seconds to propagate
 * to the syndication CDN; a fetch right after posting may return 404 / null.
 * Callers should treat absence as expected, not an error.
 *
 * The token formula matches react-tweet's reference implementation, in turn
 * derived from X's own client-side widget loader. Stable since ~2017.
 */

const SYNDICATION_BASE = 'https://cdn.syndication.twimg.com/tweet-result';

function syndicationToken(tweetId: string): string {
  return ((Number(tweetId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

export type TweetSyndication = {
  id: string;
  text: string;
  createdAt: string;
  author: {
    name: string;
    screenName: string;
    avatarUrl: string;
  };
  favoriteCount: number;
  retweetCount: number;
  replyCount: number;
};

export async function fetchTweetSyndication(
  tweetId: string,
): Promise<TweetSyndication | null> {
  try {
    const token = syndicationToken(tweetId);
    const url = `${SYNDICATION_BASE}?id=${encodeURIComponent(tweetId)}&token=${encodeURIComponent(token)}&lang=en`;
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; ViralPulse/1.0; +https://viralpulsex.com)',
      },
    });
    if (!res.ok) return null;
    const d: Record<string, unknown> = await res.json();
    const user = (d.user ?? {}) as Record<string, unknown>;
    return {
      id: (d.id_str as string) ?? tweetId,
      text: (d.text as string) ?? '',
      createdAt: (d.created_at as string) ?? new Date().toISOString(),
      author: {
        name: (user.name as string) ?? '',
        screenName: (user.screen_name as string) ?? '',
        avatarUrl: (user.profile_image_url_https as string) ?? '',
      },
      favoriteCount: (d.favorite_count as number) ?? 0,
      retweetCount: (d.retweet_count as number) ?? 0,
      replyCount: (d.conversation_count as number) ?? 0,
    };
  } catch {
    return null;
  }
}
