// PATCH /api/growth/candidates/:id — approve, reject, or edit-and-approve.
//
// Body: { action: 'approve' | 'reject', draft?: string }
//   - approve: enforces budget + per-target caps, posts via postToX, then
//     records the post + increments budget.
//   - reject: marks rejected; no post, no budget hit.
//   - draft passed alongside approve is treated as an edit — the edited
//     text is what actually gets posted (kept on the record for audit).

import { NextResponse } from 'next/server';
import { readCandidates, updateCandidate } from '@/store/candidate-store';
import {
  readTodayBudget,
  recordAction,
  usedForTarget,
  perTargetLimit,
  dailyLimit,
} from '@/store/budget-store';
import { updateTarget } from '@/store/target-store';
import { savePost } from '@/store/post-store';
import { postToX, type PostOptions, type PostResult } from '@/lib/x-poster';
import { fetchTweetSyndication } from '@/lib/x-syndication';

// A single post attempt in the fallback chain.
type Attempt = { label: 'reply' | 'quote-tweet' | 'url-embed'; opts: PostOptions };

// Errors that signal "this mechanism is blocked, try the next one" instead
// of "give up entirely". The X API returns these when reply/quote to a
// non-engaged tweet is refused under the paid-tier automation policy.
function isMechanismBlocked(msg: string): boolean {
  return (
    /Reply to this conversation is not allowed/i.test(msg) ||
    /Quoting this post is not allowed/i.test(msg)
  );
}

// Compose a regular-tweet body with the source tweet's URL appended, so X's
// auto-unfurl renders the source tweet as an embedded card — functionally
// equivalent to a quote-tweet for the reader, but posted as a plain tweet
// so it isn't gated by the API's reply/quote restrictions. If the draft
// is too long to fit with the URL, we return null and skip this attempt.
function urlEmbedBody(draft: string, sourceUrl: string): string | null {
  const spaceAndUrl = ` ${sourceUrl}`;
  const combined = `${draft}${spaceAndUrl}`;
  if (combined.length <= 280) return combined;
  const maxDraftLen = 280 - spaceAndUrl.length;
  if (maxDraftLen < 40) return null; // draft would be so short it's meaningless
  return `${draft.slice(0, maxDraftLen).trim()}${spaceAndUrl}`;
}

function ownerHandle(): string {
  return (process.env.VP_OWNER_HANDLE ?? 'jlces').toLowerCase();
}

type Params = Promise<{ id: string }>;

export async function PATCH(req: Request, ctx: { params: Params }) {
  const { id } = await ctx.params;
  const owner = ownerHandle();

  let body: { action?: string; draft?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const all = await readCandidates(owner);
  const candidate = all.find((c) => c.id === id);
  if (!candidate) {
    return NextResponse.json({ success: false, error: 'Candidate not found' }, { status: 404 });
  }
  if (candidate.status !== 'pending') {
    return NextResponse.json(
      { success: false, error: `Candidate already ${candidate.status}` },
      { status: 409 },
    );
  }

  const nowIso = new Date().toISOString();

  // ─── Reject ────────────────────────────────────────────────────────────
  if (body.action === 'reject') {
    const updated = await updateCandidate(owner, id, { status: 'rejected', actedAt: nowIso });
    return NextResponse.json({ success: true, candidate: updated });
  }

  // ─── Approve (with optional edit) ──────────────────────────────────────
  if (body.action !== 'approve') {
    return NextResponse.json(
      { success: false, error: `Unknown action "${body.action}"` },
      { status: 400 },
    );
  }

  const finalDraft = (body.draft ?? candidate.draft).trim();
  if (!finalDraft) {
    return NextResponse.json({ success: false, error: 'Draft is empty' }, { status: 400 });
  }
  if (finalDraft.length > 280) {
    return NextResponse.json(
      { success: false, error: `Draft is ${finalDraft.length} chars — max 280` },
      { status: 400 },
    );
  }

  // Budget checks — enforce daily + per-target caps at the last moment.
  const budget = await readTodayBudget(owner);
  if (budget.used >= dailyLimit()) {
    return NextResponse.json(
      { success: false, error: `Daily action cap (${dailyLimit()}) reached — try again tomorrow.` },
      { status: 429 },
    );
  }
  if (usedForTarget(budget, candidate.targetHandle) >= perTargetLimit()) {
    return NextResponse.json(
      {
        success: false,
        error: `Per-target cap (${perTargetLimit()}) reached for @${candidate.targetHandle} today.`,
      },
      { status: 429 },
    );
  }

  // Post to X via a sequential fallback chain:
  //   1. Primary — the action Claude drafted for (reply or quote-tweet).
  //   2. If the primary is a reply and X rejects it as "not allowed"
  //      (paid-tier automation policy), try a quote-tweet instead.
  //   3. If quote-tweet is also blocked, fall back to a regular tweet
  //      with the source tweet's URL appended. X auto-unfurls the URL
  //      into an embedded preview card — same reader experience as a
  //      quote-tweet, but plain tweets aren't gated by the reply/quote
  //      automation restrictions.
  // Non-block errors (rate limits, spam, etc.) bail immediately without
  // trying alternate mechanisms — those aren't going to be fixed by
  // switching post shapes.
  const attempts: Attempt[] = [];
  if (candidate.action === 'reply') {
    attempts.push({
      label: 'reply',
      opts: { text: finalDraft, accountId: 'owner', replyToTweetId: candidate.sourceTweetId },
    });
    attempts.push({
      label: 'quote-tweet',
      opts: { text: finalDraft, accountId: 'owner', quoteTweetId: candidate.sourceTweetId },
    });
  } else {
    attempts.push({
      label: 'quote-tweet',
      opts: { text: finalDraft, accountId: 'owner', quoteTweetId: candidate.sourceTweetId },
    });
  }
  const embedBody = urlEmbedBody(finalDraft, candidate.sourceTweetUrl);
  if (embedBody) {
    attempts.push({ label: 'url-embed', opts: { text: embedBody, accountId: 'owner' } });
  }

  let postResult: PostResult | null = null;
  let effectiveAction: 'reply' | 'quote_tweet' = candidate.action;
  let lastError = '';
  const errorTrail: string[] = [];

  for (const attempt of attempts) {
    try {
      postResult = await postToX(attempt.opts);
      // url-embed is functionally a quote for the reader — record it as such.
      effectiveAction = attempt.label === 'reply' ? 'reply' : 'quote_tweet';
      break;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err);
      errorTrail.push(`${attempt.label}: ${lastError}`);
      if (!isMechanismBlocked(lastError)) break; // hard failure, don't try alternates
    }
  }

  if (!postResult) {
    await updateCandidate(owner, id, {
      status: 'failed',
      actedAt: nowIso,
      draft: finalDraft,
      errorMessage: errorTrail.join(' | '),
    });
    return NextResponse.json({ success: false, error: lastError }, { status: 500 });
  }

  // Record on both sides — budget + candidate + post store.
  await recordAction({
    ownerHandle: owner,
    action: effectiveAction,
    targetHandle: candidate.targetHandle,
    candidateId: candidate.id,
    tweetId: postResult.tweetId,
  });

  await updateCandidate(owner, id, {
    status: 'posted',
    action: effectiveAction,
    actedAt: nowIso,
    draft: finalDraft,
    postedTweetId: postResult.tweetId,
    postedUrl: postResult.url,
  });

  await updateTarget(owner, candidate.targetHandle, { lastActedAt: nowIso });

  // Best-effort persist to profile feed alongside normal posts. Failures
  // here must not fail the request (the tweet is already sent).
  try {
    const stats = await fetchTweetSyndication(postResult.tweetId);
    await savePost({
      tweetId: postResult.tweetId,
      handle: owner,
      text: finalDraft,
      postedAt: nowIso,
      opportunityTopic: `Reply to @${candidate.targetHandle}`,
      xStats: stats
        ? {
            favoriteCount: stats.favoriteCount,
            retweetCount: stats.retweetCount,
            replyCount: stats.replyCount,
            capturedAt: nowIso,
          }
        : undefined,
    });
  } catch (err) {
    console.error('Failed to persist growth post to profile feed:', err);
  }

  return NextResponse.json({
    success: true,
    tweetId: postResult.tweetId,
    url: postResult.url,
  });
}
