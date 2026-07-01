// POST /api/active-galaxy  { galaxyId: 'galaxy.01' | 'galaxy.02' | 'galaxy.03' }
// GET  /api/active-galaxy
//
// Switches which galaxy the Brain uses for analysis. Per-process state —
// for multi-process deployments, persist this in the file store instead.
import { NextResponse } from 'next/server';
import { brain, GalaxyId } from '@/brain';

const VALID: GalaxyId[] = ['galaxy.01', 'galaxy.02', 'galaxy.03', 'galaxy.04', 'galaxy.05', 'galaxy.07'];

export async function GET() {
  return NextResponse.json({ success: true, activeGalaxy: brain.getActiveGalaxy() });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const galaxyId = body?.galaxyId;
    if (!VALID.includes(galaxyId)) {
      return NextResponse.json(
        { success: false, error: `Invalid galaxyId. Must be one of: ${VALID.join(', ')}` },
        { status: 400 },
      );
    }
    brain.setActiveGalaxy(galaxyId);
    return NextResponse.json({ success: true, activeGalaxy: brain.getActiveGalaxy() });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message ?? 'Invalid request body' },
      { status: 400 },
    );
  }
}
