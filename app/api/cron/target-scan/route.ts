// GET /api/cron/target-scan — scheduled scanner (Vercel cron)
//
// Hourly hit from the Vercel cron. Reads active targets whose lastScannedAt
// is > 2h old, fetches their recent tweets, drafts a reply/quote via
// Claude, and pushes drafts to the approval queue. Never posts on its
// own — every action requires human approval via the Growth tab.

import { NextResponse } from 'next/server';
import { scanTargets } from '@/lib/growth/scan-targets';

function ownerHandle(): string {
  return (process.env.VP_OWNER_HANDLE ?? 'jlces').toLowerCase();
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const report = await scanTargets(ownerHandle());
    return NextResponse.json({ success: true, report });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
