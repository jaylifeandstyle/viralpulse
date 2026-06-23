/**
 * src/store/opportunity-store.ts
 *
 * Dispatcher — picks the right backend at first call.
 *   • In production (Vercel KV env vars set)  → store-kv  (persistent)
 *   • Anywhere else (local dev, npm run scripts) → store-file (data/*.json)
 *
 * The auto-detect means local dev stays identical: no KV vars set →
 * file backend → same behavior as before this refactor. The moment you
 * deploy to Vercel and provision a KV database from the Storage tab,
 * the new env vars trigger KV mode automatically — no code change.
 *
 * Override (rare): set VP_STORE_BACKEND=file or VP_STORE_BACKEND=kv
 * explicitly to force one or the other.
 */
import { sendOpportunityToTelegram } from '@/lib/telegram';
import { StoredOpportunity } from './store-shared';

export type { StoredOpportunity } from './store-shared';

// ─── Backend selection ───────────────────────────────────────────────────

type Backend = {
  name: string;
  read: () => Promise<StoredOpportunity[]>;
  push: (opp: StoredOpportunity) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
};

let _backend: Backend | null = null;
let _backendLogged = false;

async function getBackend(): Promise<Backend> {
  if (_backend) return _backend;

  const override = process.env.VP_STORE_BACKEND?.toLowerCase();
  const kvConfigured = !!(
    process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
  );

  const useKv = override === 'kv' || (override !== 'file' && kvConfigured);

  if (useKv) {
    // Dynamic import so the @vercel/kv module is never loaded in scripts
    // that don't need it (cleaner stack traces, smaller cold start).
    const m = await import('./store-kv');
    _backend = {
      name: 'kv',
      read: m.readOpportunitiesKv,
      push: m.pushOpportunityKv,
      remove: m.removeOpportunityKv,
    };
  } else {
    const m = await import('./store-file');
    _backend = {
      name: 'file',
      read: m.readOpportunitiesFile,
      push: m.pushOpportunityFile,
      remove: m.removeOpportunityFile,
    };
  }

  if (!_backendLogged) {
    _backendLogged = true;
    console.log(`📦 Store backend: ${_backend.name}`);
  }
  return _backend;
}

// ─── Public API (async — same contract as before, with await needed) ────

/** Return all non-stale opportunities, newest first. */
export async function readOpportunities(): Promise<StoredOpportunity[]> {
  const b = await getBackend();
  return b.read();
}

/**
 * Add an opportunity to the store and fire the Telegram notification.
 * Silently skips duplicates (same topic within DEDUPE_WINDOW_MS).
 *
 * IMPORTANT — we now AWAIT the Telegram send (used to be fire-and-forget).
 * On Vercel serverless, the function context can be torn down after the
 * HTTP response is sent; an unawaited Telegram fetch would be killed
 * mid-request. Awaiting adds ~200ms per push but guarantees delivery.
 */
export async function pushOpportunity(opp: StoredOpportunity): Promise<void> {
  const b = await getBackend();
  const wasWritten = await b.push(opp);
  if (!wasWritten) return; // deduped — don't notify

  // Errors from Telegram are logged inside the lib; we still want to swallow
  // here so a Telegram failure can't break the store-push API contract.
  try {
    await sendOpportunityToTelegram(opp);
  } catch (err) {
    console.error('Telegram send threw after store push:', err);
  }
}

/** Remove an opportunity by id (used when user approves / ignores). */
export async function removeOpportunity(id: string): Promise<void> {
  const b = await getBackend();
  await b.remove(id);
}
