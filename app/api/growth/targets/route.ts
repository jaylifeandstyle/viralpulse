// /api/growth/targets
//
//   GET               → list current targets for the owner
//   POST { targets }  → upsert the picked targets
//   DELETE ?handle=x  → remove one target
//   PATCH { handle, patch } → update status / notes on one target

import { NextResponse } from 'next/server';
import {
  readTargets,
  saveTargets,
  removeTarget,
  updateTarget,
} from '@/store/target-store';
import type { StoredTarget } from '@/store/store-shared';

function ownerHandle(): string {
  return (process.env.VP_OWNER_HANDLE ?? 'jlces').toLowerCase();
}

function coerceHandle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const stripped = raw.trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-zA-Z0-9_]{1,15}$/.test(stripped)) return null;
  return stripped;
}

export async function GET() {
  const targets = await readTargets(ownerHandle());
  return NextResponse.json({ success: true, targets });
}

export async function POST(req: Request) {
  let body: { targets?: Array<Partial<StoredTarget>> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }
  if (!Array.isArray(body.targets)) {
    return NextResponse.json({ success: false, error: 'targets must be an array' }, { status: 400 });
  }

  const owner = ownerHandle();
  const now = new Date().toISOString();
  const clean: StoredTarget[] = [];
  for (const t of body.targets) {
    const handle = coerceHandle(t.handle);
    if (!handle || handle === owner) continue;
    clean.push({
      ownerHandle: owner,
      handle,
      displayName: t.displayName,
      bio: t.bio,
      followersCount: t.followersCount,
      reason: t.reason,
      source: t.source === 'manual' ? 'manual' : 'claude',
      status: 'active',
      addedAt: now,
    });
  }

  await saveTargets(owner, clean);
  const targets = await readTargets(owner);
  return NextResponse.json({ success: true, targets });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const handle = coerceHandle(url.searchParams.get('handle'));
  if (!handle) {
    return NextResponse.json({ success: false, error: 'Invalid handle' }, { status: 400 });
  }
  await removeTarget(ownerHandle(), handle);
  return NextResponse.json({ success: true });
}

export async function PATCH(req: Request) {
  let body: { handle?: string; patch?: Partial<StoredTarget> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const handle = coerceHandle(body.handle);
  if (!handle) {
    return NextResponse.json({ success: false, error: 'Invalid handle' }, { status: 400 });
  }
  const patch = body.patch ?? {};
  // Never let clients overwrite immutable/identity fields via patch.
  delete (patch as Partial<StoredTarget>).ownerHandle;
  delete (patch as Partial<StoredTarget>).handle;
  delete (patch as Partial<StoredTarget>).addedAt;

  const updated = await updateTarget(ownerHandle(), handle, patch);
  if (!updated) {
    return NextResponse.json({ success: false, error: 'Target not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true, target: updated });
}
