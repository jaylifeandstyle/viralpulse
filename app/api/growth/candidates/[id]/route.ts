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
import { postToX } from '@/lib/x-poster';
import { fetchTweetSyndication } from '@/lib/x-syndication';

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

  // Post to X.
  let postResult: { tweetId: string; url: string };
  try {
    postResult = await postToX({
      text: finalDraft,
      accountId: 'owner',
      replyToTweetId: candidate.action === 'reply' ? candidate.sourceTweetId : undefined,
      quoteTweetId: candidate.action === 'quote_tweet' ? candidate.sourceTweetId : undefined,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateCandidate(owner, id, {
      status: 'failed',
      actedAt: nowIso,
      draft: finalDraft,
      errorMessage: msg,
    });
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }

  // Record on both sides — budget + candidate + post store.
  await recordAction({
    ownerHandle: owner,
    action: candidate.action,
    targetHandle: candidate.targetHandle,
    candidateId: candidate.id,
    tweetId: postResult.tweetId,
  });

  await updateCandidate(owner, id, {
    status: 'posted',
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
