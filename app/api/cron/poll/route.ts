// POST /api/cron/poll  (also responds to GET — Vercel cron uses GET)
//
// Vercel cron hits this route on the schedule defined in vercel.json (hourly).
// We verify the CRON_SECRET header so random internet traffic can't trigger
// Galaxy cycles.
//
// Cron mode defaults to Galaxy.04 (news-first, Haiku, ~$0.02/cycle). To run
// a different galaxy, set GALAXY_CRON_MODE in Vercel env vars:
//   GALAXY_CRON_MODE=galaxy.05   (hybrid — needs X_BEARER_TOKEN for trends)
//   GALAXY_CRON_MODE=galaxy.04   (default)
//   GALAXY_CRON_MODE=galaxy.03   (X Trends — needs X_BEARER_TOKEN)
//
// IMPORTANT — file-store limitation on Vercel:
// On serverless, pushOpportunity() writes to data/opportunities.json which
// is ephemeral. Opportunities will NOT persist between cron runs unless you
// swap opportunity-store.ts for Vercel KV / Postgres / external storage.
// The Telegram push hook (in store/opportunity-store.ts) DOES still fire —
// so cron + Telegram works end-to-end even without persistent storage.

import { NextRequest, NextResponse } from 'next/server';
import { Galaxy04 } from '@/galaxies/galaxy.04';
import { Galaxy03 } from '@/galaxies/galaxy.03';
import { Galaxy05 } from '@/galaxies/galaxy.05';
import { UserPreferences } from '@/shared/types';

const DEFAULT_USER_PREFS: UserPreferences = {
  userId: 'cron-poll',
  mode: 'pure_growth',
  aggressiveness: 7,
  weeklyFollowerTarget: 1000,
  niches: ['breaking news', 'politics', 'technology', 'AI', 'business', 'sports', 'entertainment'],
};

async function handle(req: NextRequest) {
  // Verify Vercel's CRON_SECRET (set automatically when you add a cron job)
  const auth = req.headers.get('authorization') ?? '';
  const expected = process.env.CRON_SECRET;
  if (expected && auth !== `Bearer ${expected}`) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const mode = (process.env.GALAXY_CRON_MODE ?? 'galaxy.04') as
    | 'galaxy.03'
    | 'galaxy.04'
    | 'galaxy.05';

  try {
    if (mode === 'galaxy.05') {
      const galaxy = new Galaxy05();
      const opps = await galaxy.runHybridAnalysis({
        userPrefs: DEFAULT_USER_PREFS,
        pushToStore: true,
        autoPost: process.env.VP_AUTO_POST === 'true',
      });
      return NextResponse.json({ success: true, mode, pushed: opps.length });
    }

    if (mode === 'galaxy.03') {
      const galaxy = new Galaxy03();
      const opps = await galaxy.runTrendsAnalysis({
        userPrefs: DEFAULT_USER_PREFS,
        woeid: 1,
        maxTrends: 5,
        pushToStore: true,
      });
      return NextResponse.json({ success: true, mode, pushed: opps.length });
    }

    // Default: Galaxy.04 — news-first, no X token required
    const galaxy = new Galaxy04();
    const opps = await galaxy.runNewsAnalysis({
      userPrefs: DEFAULT_USER_PREFS,
      pushToStore: true,
    });
    return NextResponse.json({ success: true, mode, pushed: opps.length });
  } catch (err: any) {
    console.error('Cron poll failed:', err);
    return NextResponse.json(
      { success: false, mode, error: err.message ?? 'Unknown error' },
      { status: 500 },
    );
  }
}

// Vercel cron sends GET; allow POST too for manual triggering during local dev
export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
