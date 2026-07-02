// POST /api/growth/scan — manual "Scan now" trigger from the Growth tab.
//
// Same code path as the cron scanner. No auth beyond same-origin because
// generating drafts costs cents and posting still requires human approval.

import { NextResponse } from 'next/server';
import { scanTargets } from '@/lib/growth/scan-targets';

function ownerHandle(): string {
  return (process.env.VP_OWNER_HANDLE ?? 'jlces').toLowerCase();
}

export async function POST() {
  try {
    const report = await scanTargets(ownerHandle());
    return NextResponse.json({ success: true, report });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
