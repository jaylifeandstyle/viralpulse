// POST /api/post-to-x
// Body: { text, imageUrl?, imageUrls?, videoUrl?, oppId?, accounts?: AccountId[] }
//
// Posts to one or more accounts. For each selected account it sends the
// tweet, persists a StoredPost under that account's handle, and captures
// initial X stats. Defaults to the owner account when `accounts` is omitted.

import { NextResponse } from 'next/server';
import { postToX, isPostingConfigured } from '@/lib/x-poster';
import { readOpportunities, removeOpportunity } from '@/store/opportunity-store';
import { savePost } from '@/store/post-store';
import { fetchTweetSyndication } from '@/lib/x-syndication';
import { AccountId, getPostingAccount, accountOptions } from '@/lib/x-accounts';

function parseUrlList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const urls = raw
    .map((u) => (typeof u === 'string' ? u.trim() : ''))
    .filter((u) => /^https?:\/\//i.test(u));
  return urls.length ? urls.slice(0, 2) : undefined;
}

function parseAccounts(raw: unknown): AccountId[] {
  const valid: AccountId[] = ['owner', 'brand'];
  if (!Array.isArray(raw)) return ['owner'];
  const ids = raw.filter((x): x is AccountId => valid.includes(x as AccountId));
  return ids.length ? [...new Set(ids)] : ['owner'];
}

type PostOutcome = {
  accountId: AccountId;
  handle: string;
  ok: boolean;
  tweetId?: string;
  url?: string;
  error?: string;
};

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
    accounts?: AccountId[];
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
  const accounts = parseAccounts(body.accounts);

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

  // Reject accounts that aren't actually configured (e.g. brand selected but
  // its tokens are missing) before posting anything.
  for (const id of accounts) {
    if (!getPostingAccount(id)) {
      return NextResponse.json(
        { success: false, error: `Account "${id}" is not configured.` },
        { status: 400 },
      );
    }
  }

  // Snapshot the source opportunity BEFORE we remove it so each persisted
  // post record can carry topic/contentAngle for later display.
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

  const outcomes: PostOutcome[] = [];
  for (const accountId of accounts) {
    const account = getPostingAccount(accountId)!;
    try {
      const result = await postToX({ text, imageUrl, imageUrls, videoUrl, accountId });

      // Persist the post for this account's profile feed. Best-effort —
      // failures here must NOT fail the request; the tweet is already sent.
      try {
        const stats = await fetchTweetSyndication(result.tweetId);
        await savePost({
          tweetId: result.tweetId,
          handle: account.handle,
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

      outcomes.push({
        accountId,
        handle: account.handle,
        ok: true,
        tweetId: result.tweetId,
        url: result.url,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      outcomes.push({ accountId, handle: account.handle, ok: false, error: msg });
    }
  }

  const anyOk = outcomes.some((o) => o.ok);

  // Remove the opportunity once at least one post landed.
  if (oppId && anyOk) {
    try {
      await removeOpportunity(oppId);
    } catch (err) {
      console.error('Failed to remove opportunity after post:', err);
    }
  }

  return NextResponse.json(
    { success: anyOk, results: outcomes },
    { status: anyOk ? 200 : 500 },
  );
}

export async function GET() {
  return NextResponse.json({
    configured: isPostingConfigured(),
    accounts: accountOptions(),
  });
}
