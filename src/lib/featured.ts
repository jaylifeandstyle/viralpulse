/**
 * src/lib/featured.ts
 *
 * The set of handles that power the public surfaces:
 *   - which /@handle profile routes are allowed to render
 *   - which accounts the "For You" feed and Suggested Profiles card pull from
 *
 * Single source of truth so adding an account later is one env change.
 * Defaults cover the launch set (owner + brand). Server-only — never
 * expose via NEXT_PUBLIC; the client gets these via /api/feed instead.
 */

export function featuredHandles(): string[] {
  const raw = process.env.VP_FEATURED_HANDLES ?? 'jlces,viralpulsex_ai';
  const handles = raw
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(handles)];
}

export function ownerHandle(): string {
  return (process.env.VP_OWNER_HANDLE ?? 'jlces').toLowerCase();
}
