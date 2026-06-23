// POST /api/galaxy03-trends   { woeid?: number, maxTrends?: number, minVolume?: number }
//
// Fetches live X trends and runs them through Galaxy.03.
// Approved opportunities are pushed to the shared file store, so the
// dashboard's existing /api/opportunities poll picks them up automatically.
import { NextResponse } from 'next/server';
import { Galaxy03 } from '@/galaxies/galaxy.03';
import { pushOpportunity } from '@/store/opportunity-store';
import { UserPreferences } from '@/shared/types';

const DEFAULT_USER_PREFS: UserPreferences = {
  userId: 'galaxy03-auto',
  mode: 'pure_growth',
  aggressiveness: 7,
  weeklyFollowerTarget: 1000,
  niches: ['breaking news', 'politics', 'technology', 'AI', 'business'],
};

export async function POST(req: Request) {
  if (!process.env.X_BEARER_TOKEN) {
    return NextResponse.json(
      { success: false, error: 'X_BEARER_TOKEN not set — cannot fetch trends.' },
      { status: 503 },
    );
  }
  if (!process.env.VP_ANTHROPIC_KEY && !process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { success: false, error: 'No Anthropic API key — set VP_ANTHROPIC_KEY in .env.local.' },
      { status: 503 },
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // Empty body is fine — use defaults
  }

  const { woeid, maxTrends, minVolume } = body ?? {};

  try {
    const galaxy = new Galaxy03();
    const opportunities = await galaxy.runTrendsAnalysis({
      userPrefs: DEFAULT_USER_PREFS,
      woeid,
      maxTrends,
      minVolume,
    });

    // Push approved opportunities to the shared store so the dashboard sees them.
    for (const opp of opportunities) {
      await pushOpportunity(opp);
    }

    return NextResponse.json({
      success: true,
      pushed: opportunities.length,
      opportunities,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message ?? 'Unknown error' },
      { status: 500 },
    );
  }
}
