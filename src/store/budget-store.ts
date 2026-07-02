/**
 * src/store/budget-store.ts
 *
 * Dispatcher for the daily action budget. Buckets by owner + YYYY-MM-DD
 * in the owner's timezone. Small helper on top of the raw backend to
 * initialize a fresh day, and to increment/verify atomically at the
 * dispatcher level (both backends are single-key so the read-modify-write
 * race pattern matches).
 */
import { ActionBudget, CandidateAction } from './store-shared';

export type { ActionBudget } from './store-shared';

type BudgetBackend = {
  name: string;
  read: (ownerHandle: string, date: string) => Promise<ActionBudget | null>;
  write: (budget: ActionBudget) => Promise<void>;
};

let _backend: BudgetBackend | null = null;

async function getBackend(): Promise<BudgetBackend> {
  if (_backend) return _backend;

  const override = process.env.VP_STORE_BACKEND?.toLowerCase();
  const kvConfigured = !!(
    (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ||
    (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
  );
  const useKv = override === 'kv' || (override !== 'file' && kvConfigured);

  if (useKv) {
    const m = await import('./store-kv');
    _backend = { name: 'kv', read: m.readBudgetKv, write: m.writeBudgetKv };
  } else {
    const m = await import('./store-file');
    _backend = { name: 'file', read: m.readBudgetFile, write: m.writeBudgetFile };
  }
  return _backend;
}

/** Day cap for autonomous posting — env-tunable so we can dial it up/down. */
export function dailyLimit(): number {
  const raw = process.env.VP_DAILY_ACTION_CAP;
  const n = raw ? Number(raw) : 20;
  return Number.isFinite(n) && n > 0 ? n : 20;
}

export function timezone(): string {
  return process.env.VP_TIMEZONE ?? 'America/New_York';
}

export function todayInOwnerTz(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: timezone() });
}

/** Read today's budget, initializing a fresh empty one if none exists. */
export async function readTodayBudget(ownerHandle: string): Promise<ActionBudget> {
  const b = await getBackend();
  const date = todayInOwnerTz();
  const existing = await b.read(ownerHandle, date);
  if (existing) return existing;
  return {
    ownerHandle,
    date,
    used: 0,
    limit: dailyLimit(),
    actions: [],
  };
}

/** Record a successful action. Returns the new budget snapshot. */
export async function recordAction(params: {
  ownerHandle: string;
  action: CandidateAction;
  targetHandle: string;
  candidateId: string;
  tweetId?: string;
}): Promise<ActionBudget> {
  const b = await getBackend();
  const current = await readTodayBudget(params.ownerHandle);
  const updated: ActionBudget = {
    ...current,
    used: current.used + 1,
    actions: [
      ...current.actions,
      {
        at: new Date().toISOString(),
        type: params.action,
        targetHandle: params.targetHandle,
        candidateId: params.candidateId,
        tweetId: params.tweetId,
      },
    ],
  };
  await b.write(updated);
  return updated;
}

/** How many actions have already hit this target today. */
export function usedForTarget(budget: ActionBudget, targetHandle: string): number {
  const h = targetHandle.toLowerCase();
  return budget.actions.filter((a) => a.targetHandle.toLowerCase() === h).length;
}

/** Per-target daily cap (env-tunable). */
export function perTargetLimit(): number {
  const raw = process.env.VP_PER_TARGET_CAP;
  const n = raw ? Number(raw) : 3;
  return Number.isFinite(n) && n > 0 ? n : 3;
}
