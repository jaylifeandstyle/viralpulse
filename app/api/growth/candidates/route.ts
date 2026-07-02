// GET /api/growth/candidates
//
// Returns pending candidates + today's budget in one call so the queue
// UI can render in a single fetch. Expired candidates are filtered out
// server-side so the client only sees actionable items.

import { NextResponse } from 'next/server';
import { readCandidates } from '@/store/candidate-store';
import { readTodayBudget, dailyLimit } from '@/store/budget-store';

function ownerHandle(): string {
  return (process.env.VP_OWNER_HANDLE ?? 'jlces').toLowerCase();
}

export async function GET() {
  try {
    const owner = ownerHandle();
    const [all, budget] = await Promise.all([
      readCandidates(owner),
      readTodayBudget(owner),
    ]);

    const now = Date.now();
    const pending = all.filter(
      (c) => c.status === 'pending' && new Date(c.expiresAt).getTime() > now,
    );
    // Sort newest first so freshest scans surface at the top.
    pending.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    return NextResponse.json({
      success: true,
      pending,
      budget: {
        date: budget.date,
        used: budget.used,
        limit: budget.limit,
      },
      caps: {
        daily: dailyLimit(),
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
