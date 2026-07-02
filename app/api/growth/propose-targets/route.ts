// POST /api/growth/propose-targets
//
// Runs the one-time target-proposal analysis for the owner account.
// 1. Fetch OwnerSignal from X (recent tweets, follows, bookmarks, likes)
// 2. Hand to Claude Sonnet -> get 30–50 ranked proposals
// 3. Return proposals + a summary of what data made it through
//
// Doesn't save anything — the client presents proposals, user picks their
// 20, then POSTs to /api/growth/targets. Cheap to re-run (~$5–15 X API +
// ~$1 Claude) if the archive lands or interests shift.

import { NextResponse } from 'next/server';
import { fetchOwnerSignal } from '@/lib/growth/fetch-owner-signal';
import { proposeTargets } from '@/lib/growth/propose-targets';

function ownerHandle(): string {
  return (process.env.VP_OWNER_HANDLE ?? 'jlces').toLowerCase();
}

export async function POST() {
  try {
    const signal = await fetchOwnerSignal(ownerHandle());
    const proposals = await proposeTargets(signal);
    return NextResponse.json({
      success: true,
      proposals,
      signalSummary: {
        tweetSamples: signal.recentTweetSamples.length,
        following: signal.following.length,
        bookmarks: signal.bookmarkedTexts.length,
        likes: signal.likedAuthors.length,
        notes: signal.notes,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
