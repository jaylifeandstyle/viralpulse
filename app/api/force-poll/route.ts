// POST /api/force-poll
//
// Routes through the currently-active galaxy:
//   - galaxy.05 → Galaxy.05 hybrid (BBC RSS + X Trends + Haiku, optional auto-post)
//   - galaxy.04 → Galaxy.04 news mode (BBC RSS categories + Haiku 4.5)
//   - galaxy.03 → Galaxy.03 trends mode (X Trends API + Haiku 4.5)
//   - galaxy.01 / galaxy.02 → LowCostDetector (X Search + active galaxy)
//
// "Force Poll Now" thus does the right thing for whichever galaxy is selected.
import { NextResponse } from 'next/server';
import { LowCostDetector } from '@/lib/low-cost-detector';
import { Galaxy03 } from '@/galaxies/galaxy.03';
import { Galaxy04 } from '@/galaxies/galaxy.04';
import { Galaxy05 } from '@/galaxies/galaxy.05';
import { brain } from '@/brain';
import { UserPreferences } from '@/shared/types';

const DEFAULT_USER_PREFS: UserPreferences = {
  userId: 'force-poll-auto',
  mode: 'pure_growth',
  aggressiveness: 7,
  weeklyFollowerTarget: 1000,
  niches: ['breaking news', 'politics', 'technology', 'AI', 'business'],
};

export async function POST() {
  const activeGalaxy = brain.getActiveGalaxy();

  // Galaxy.04 / .05 use BBC RSS without X reads; .05 optionally calls trends if token set
  const needsBearer = !['galaxy.04', 'galaxy.05'].includes(activeGalaxy);
  if (needsBearer && !process.env.X_BEARER_TOKEN) {
    return NextResponse.json(
      { success: false, error: 'X_BEARER_TOKEN not set — detector cannot run.' },
      { status: 503 }
    );
  }

  try {
    if (activeGalaxy === 'galaxy.05') {
      const galaxy = new Galaxy05();
      const opps = await galaxy.runHybridAnalysis({
        userPrefs: DEFAULT_USER_PREFS,
        pushToStore: true,
        autoPost: process.env.VP_AUTO_POST === 'true',
      });
      return NextResponse.json({
        success: true,
        mode: 'hybrid',
        activeGalaxy,
        pushed: opps.length,
      });
    }

    if (activeGalaxy === 'galaxy.04') {
      const galaxy = new Galaxy04();
      const opps = await galaxy.runNewsAnalysis({
        userPrefs: DEFAULT_USER_PREFS,
        pushToStore: true,
      });
      return NextResponse.json({
        success: true,
        mode: 'news',
        activeGalaxy,
        pushed: opps.length,
      });
    }

    if (activeGalaxy === 'galaxy.03') {
      // Trends mode — pure X Trends API + Haiku 4.5
      const galaxy = new Galaxy03();
      const opps = await galaxy.runTrendsAnalysis({
        userPrefs: DEFAULT_USER_PREFS,
        woeid: 1,
        maxTrends: 5,
        minVolume: 10000,
        pushToStore: true,
      });
      return NextResponse.json({
        success: true,
        mode: 'trends',
        activeGalaxy,
        pushed: opps.length,
      });
    }

    // Search mode — LowCostDetector routes its results through the active galaxy
    const detector = new LowCostDetector();
    await detector.runOnce();
    return NextResponse.json({
      success: true,
      mode: 'search',
      activeGalaxy,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message, activeGalaxy },
      { status: 500 }
    );
  }
}
