import { NextResponse } from 'next/server';
import { brain } from '@/brain';
import { OpportunitySignals, UserPreferences } from '@/shared/types';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { signals, userPrefs } = body;

    if (!signals || !userPrefs) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: signals and userPrefs' },
        { status: 400 }
      );
    }

    const cleanSignals: OpportunitySignals = {
      ...signals,
      timestamp: new Date(signals.timestamp),
    };

    const result = await brain.processOpportunity(cleanSignals, userPrefs as UserPreferences);

    return NextResponse.json({ success: true, result });
  } catch (error: any) {
    console.error('❌ /api/generate-opportunity error:', error);
    return NextResponse.json(
      { success: false, error: error.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}
