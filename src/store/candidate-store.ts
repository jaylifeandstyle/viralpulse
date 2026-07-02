/**
 * src/store/candidate-store.ts
 *
 * Dispatcher for growth candidates — drafted replies/quote-tweets sitting
 * in the approval queue. Same file-vs-KV auto-detect as the other stores.
 */
import { StoredCandidate } from './store-shared';

export type { StoredCandidate } from './store-shared';

type CandidateBackend = {
  name: string;
  read: (ownerHandle: string) => Promise<StoredCandidate[]>;
  save: (candidate: StoredCandidate) => Promise<void>;
  update: (
    ownerHandle: string,
    id: string,
    patch: Partial<StoredCandidate>,
  ) => Promise<StoredCandidate | null>;
};

let _backend: CandidateBackend | null = null;

async function getBackend(): Promise<CandidateBackend> {
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
      read: m.readCandidatesKv,
      save: m.saveCandidateKv,
      update: m.updateCandidateKv,
    };
  } else {
    const m = await import('./store-file');
    _backend = {
      name: 'file',
      read: m.readCandidatesFile,
      save: m.saveCandidateFile,
      update: m.updateCandidateFile,
    };
  }
  return _backend;
}

export async function readCandidates(ownerHandle: string): Promise<StoredCandidate[]> {
  const b = await getBackend();
  return b.read(ownerHandle);
}

export async function saveCandidate(candidate: StoredCandidate): Promise<void> {
  const b = await getBackend();
  await b.save(candidate);
}

export async function updateCandidate(
  ownerHandle: string,
  id: string,
  patch: Partial<StoredCandidate>,
): Promise<StoredCandidate | null> {
  const b = await getBackend();
  return b.update(ownerHandle, id, patch);
}
