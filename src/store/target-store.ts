/**
 * src/store/target-store.ts
 *
 * Dispatcher for the growth-targeting list — the curated set of accounts
 * we reply/quote-tweet to for follower growth (G3). Same file-vs-KV
 * detection pattern as the other stores.
 */
import { StoredTarget } from './store-shared';

export type { StoredTarget } from './store-shared';

type TargetBackend = {
  name: string;
  read: (ownerHandle: string) => Promise<StoredTarget[]>;
  save: (ownerHandle: string, targets: StoredTarget[]) => Promise<void>;
  remove: (ownerHandle: string, handle: string) => Promise<void>;
  update: (
    ownerHandle: string,
    handle: string,
    patch: Partial<StoredTarget>,
  ) => Promise<StoredTarget | null>;
};

let _backend: TargetBackend | null = null;

async function getBackend(): Promise<TargetBackend> {
  if (_backend) return _backend;

  const override = process.env.VP_STORE_BACKEND?.toLowerCase();
  const kvConfigured = !!(
    (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ||
    (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
  );

  const useKv = override === 'kv' || (override !== 'file' && kvConfigured);

  if (useKv) {
    const m = await import('./store-kv');
    _backend = {
      name: 'kv',
      read: m.readTargetsKv,
      save: m.saveTargetsKv,
      remove: m.removeTargetKv,
      update: m.updateTargetKv,
    };
  } else {
    const m = await import('./store-file');
    _backend = {
      name: 'file',
      read: m.readTargetsFile,
      save: m.saveTargetsFile,
      remove: m.removeTargetFile,
      update: m.updateTargetFile,
    };
  }
  return _backend;
}

export async function readTargets(ownerHandle: string): Promise<StoredTarget[]> {
  const b = await getBackend();
  return b.read(ownerHandle);
}

export async function saveTargets(
  ownerHandle: string,
  targets: StoredTarget[],
): Promise<void> {
  const b = await getBackend();
  await b.save(ownerHandle, targets);
}

export async function removeTarget(ownerHandle: string, handle: string): Promise<void> {
  const b = await getBackend();
  await b.remove(ownerHandle, handle);
}

export async function updateTarget(
  ownerHandle: string,
  handle: string,
  patch: Partial<StoredTarget>,
): Promise<StoredTarget | null> {
  const b = await getBackend();
  return b.update(ownerHandle, handle, patch);
}
