// app/api/test-brain/route.ts
import { NextResponse } from 'next/server';
import { brain } from '@/brain';
import { UserPreferences, OpportunitySignals } from '@/shared/types';

export async function GET() {
  try {
    const testUserPrefs: UserPreferences = {
      userId: "test-user",
      mode: "pure_growth",
      aggressiveness: 8,
      weeklyFollowerTarget: 800,
      niches: ["news", "breaking news", "technology"],
    };

    const testSignals: OpportunitySignals = {
      topic: "Apple just announced something big",
      velocity: 245,
      acceleration: 340,
      avgEngagement: 1240,
      trending: true,
      samplePosts: [],
      timestamp: new Date(),
    };

    const result = await brain.processOpportunity(testSignals, testUserPrefs);

    return NextResponse.json({
      success: true,
      message: "Brain + Galaxy.01 working!",
      activeGalaxy: result.galaxyId,
      recommendation: result
    });

  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}