/**
 * src/store/profile-store.ts
 *
 * Dispatcher for StoredProfile. Same file-vs-KV detection as the other
 * stores. Holds the cached X profile data (name, bio, avatar, follower
 * counts) plus future user overrides.
 */
import { StoredProfile } from './store-shared';

export type { StoredProfile } from './store-shared';

type ProfileBackend = {
  name: string;
  read: (handle: string) => Promise<StoredProfile | null>;
  write: (profile: StoredProfile) => Promise<void>;
};

let _backend: ProfileBackend | null = null;

async function getBackend(): Promise<ProfileBackend> {
  if (_backend) return _backend;

  const override = process.env.VP_STORE_BACKEND?.toLowerCase();
  const kvConfigured = !!(
    (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ||
    (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
  );

  const useKv = override === 'kv' || (override !== 'file' && kvConfigured);

  if (useKv) {
    const m = await import('./store-kv');
    _backend = { name: 'kv', read: m.readProfileKv, write: m.writeProfileKv };
  } else {
    const m = await import('./store-file');
    _backend = { name: 'file', read: m.readProfileFile, write: m.writeProfileFile };
  }
  return _backend;
}

export async function readProfile(handle: string): Promise<StoredProfile | null> {
  const b = await getBackend();
  return b.read(handle);
}

export async function writeProfile(profile: StoredProfile): Promise<void> {
  const b = await getBackend();
  await b.write(profile);
}
