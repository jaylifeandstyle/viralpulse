// POST /api/post-to-x
// Body: { text, imageUrl?, imageUrls?, videoUrl?, oppId? }

import { NextResponse } from 'next/server';
import { postToX, isPostingConfigured } from '@/lib/x-poster';
import { readOpportunities, removeOpportunity } from '@/store/opportunity-store';
import { savePost } from '@/store/post-store';
import { fetchTweetSyndication } from '@/lib/x-syndication';

function parseUrlList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const urls = raw
    .map((u) => (typeof u === 'string' ? u.trim() : ''))
    .filter((u) => /^https?:\/\//i.test(u));
  return urls.length ? urls.slice(0, 2) : undefined;
}

export async function POST(req: Request) {
  if (!isPostingConfigured()) {
    return NextResponse.json(
      {
        success: false,
        error:
          'X posting is not configured. Add X_ACCESS_TOKEN and X_ACCESS_TOKEN_SECRET to .env.local.',
        configured: false,
      },
      { status: 503 },
    );
  }

  let body: {
    text?: string;
    imageUrl?: string;
    imageUrls?: string[];
    videoUrl?: string;
    oppId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const text = (body.text ?? '').trim();
  const imageUrl = body.imageUrl?.trim() || undefined;
  const imageUrls = parseUrlList(body.imageUrls);
  const videoUrl = body.videoUrl?.trim() || undefined;
  const oppId = body.oppId?.trim() || undefined;

  if (!text) {
    return NextResponse.json({ success: false, error: 'text is required' }, { status: 400 });
  }
  if (text.length > 280) {
    return NextResponse.json(
      { success: false, error: `Tweet is ${text.length} chars — max 280` },
      { status: 400 },
    );
  }

  for (const u of [imageUrl, ...(imageUrls ?? []), videoUrl].filter(Boolean) as string[]) {
    if (!/^https?:\/\//i.test(u)) {
      return NextResponse.json(
        { success: false, error: 'All media URLs must be fully-qualified http(s)' },
        { status: 400 },
      );
    }
  }

  // Snapshot the source opportunity BEFORE we remove it so the persisted
  // post record can carry topic/contentAngle for later display on the profile.
  let oppTopic: string | undefined;
  let oppAngle: string | undefined;
  if (oppId) {
    try {
      const opps = await readOpportunities();
      const opp = opps.find((o) => o.id === oppId);
      oppTopic = opp?.topic;
      oppAngle = opp?.contentAngle;
    } catch (err) {
      console.error('Failed to read opportunity for snapshot:', err);
    }
  }

  try {
    const result = await postToX({ text, imageUrl, imageUrls, videoUrl });

    if (oppId) {
      try {
        await removeOpportunity(oppId);
      } catch (err) {
        console.error('Failed to remove opportunity after post:', err);
      }
    }

    // Persist the post for the profile feed. Best-effort — failures here
    // must NOT fail the request because the tweet has already been sent.
    try {
      const handle = (process.env.VP_OWNER_HANDLE ?? 'jay').toLowerCase();
      const stats = await fetchTweetSyndication(result.tweetId);
      await savePost({
        tweetId: result.tweetId,
        handle,
        text,
        imageUrl,
        postedAt: new Date().toISOString(),
        opportunityTopic: oppTopic,
        contentAngle: oppAngle,
        xStats: stats
          ? {
              favoriteCount: stats.favoriteCount,
              retweetCount: stats.retweetCount,
              replyCount: stats.replyCount,
              capturedAt: new Date().toISOString(),
            }
          : undefined,
      });
    } catch (err) {
      console.error('Failed to persist post record:', err);
    }

    return NextResponse.json({
      success: true,
      tweetId: result.tweetId,
      url: result.url,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ configured: isPostingConfigured() });
}
