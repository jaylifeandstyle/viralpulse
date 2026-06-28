/**
 * src/lib/x-profile.ts
 *
 * Fetches X user profile (name, bio, avatar, follower counts) and caches
 * it in the profile-store with a TTL. Falls back to the cached copy on
 * fetch failure so the profile page never goes blank.
 *
 * Cost note — this calls a paid X v2 endpoint (`users/by/username/:handle`).
 * Caching for 24h means at most 1 call per handle per day. At our launch
 * volume this is trivial. The cache TTL can be tuned via env.
 */

import { TwitterApi } from 'twitter-api-v2';
import { readProfile, writeProfile, readProfileOverrides } from '@/store/profile-store';
import { StoredProfile, StoredProfileOverrides } from '@/store/store-shared';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function ttlMs(): number {
  const raw = process.env.VP_PROFILE_TTL_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_MS;
}

function isStale(profile: StoredProfile): boolean {
  return Date.now() - new Date(profile.fetchedAt).getTime() > ttlMs();
}

function hasXCredentials(): boolean {
  return !!(
    process.env.X_CLIENT_ID &&
    process.env.X_CLIENT_SECRET &&
    process.env.X_ACCESS_TOKEN &&
    process.env.X_ACCESS_TOKEN_SECRET
  );
}

async function fetchFromX(handle: string): Promise<StoredProfile | null> {
  if (!hasXCredentials()) return null;
  try {
    const client = new TwitterApi({
      appKey: process.env.X_CLIENT_ID!,
      appSecret: process.env.X_CLIENT_SECRET!,
      accessToken: process.env.X_ACCESS_TOKEN!,
      accessSecret: process.env.X_ACCESS_TOKEN_SECRET!,
    });
    const res = await client.v2.userByUsername(handle, {
      'user.fields': ['profile_image_url', 'description', 'public_metrics'],
    });
    const u = res.data;
    if (!u) return null;
    return {
      handle: handle.toLowerCase(),
      displayName: u.name,
      bio: u.description,
      // The 'normal' avatar URL is 48x48; '_400x400' is the larger version
      // used everywhere on the profile UI. Swap if the URL ends in _normal.
      avatarUrl: u.profile_image_url?.replace('_normal.', '_400x400.'),
      followersCount: u.public_metrics?.followers_count,
      followingCount: u.public_metrics?.following_count,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error('X profile fetch failed:', err);
    return null;
  }
}

function applyOverrides(
  base: StoredProfile | null,
  overrides: StoredProfileOverrides | null,
  handle: string,
): StoredProfile | null {
  if (!base && !overrides) return null;
  const baseSafe = base ?? { handle, fetchedAt: new Date(0).toISOString() };
  if (!overrides) return baseSafe;
  return {
    ...baseSafe,
    displayName: overrides.displayName ?? baseSafe.displayName,
    bio: overrides.bio ?? baseSafe.bio,
    avatarUrl: overrides.avatarUrl ?? baseSafe.avatarUrl,
    bannerUrl: overrides.bannerUrl ?? baseSafe.bannerUrl,
  };
}

/**
 * Cache-first profile lookup. Returns the cached value if fresh; otherwise
 * tries a refresh from X. If X is down/unreachable, returns the stale
 * cache so the page still renders. User-set overrides are layered on top.
 */
export async function getProfile(handle: string): Promise<StoredProfile | null> {
  const normalized = handle.toLowerCase();
  const [cached, overrides] = await Promise.all([
    readProfile(normalized),
    readProfileOverrides(normalized),
  ]);

  // Fresh cache → return with overrides applied.
  if (cached && !isStale(cached)) return applyOverrides(cached, overrides, normalized);

  const fresh = await fetchFromX(normalized);
  if (fresh) {
    await writeProfile(fresh);
    return applyOverrides(fresh, overrides, normalized);
  }

  // Refresh failed — fall back to whatever we had cached, even if stale.
  return applyOverrides(cached, overrides, normalized);
}
