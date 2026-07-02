'use client';

import { useEffect, useState } from 'react';
import type { StoredTarget } from '@/store/store-shared';

type Proposal = { handle: string; reason: string };
type SignalSummary = {
  tweetSamples: number;
  following: number;
  bookmarks: number;
  likes: number;
  notes: string[];
};

const CAP = 20;

export function GrowthTab() {
  const [targets, setTargets] = useState<StoredTarget[]>([]);
  const [loading, setLoading] = useState(true);

  // Proposal state (only populated while user is picking)
  const [proposing, setProposing] = useState(false);
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [signalSummary, setSignalSummary] = useState<SignalSummary | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [savingPicks, setSavingPicks] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTargets = async () => {
    try {
      const res = await fetch('/api/growth/targets');
      const data = await res.json();
      if (data.success) setTargets(data.targets ?? []);
    } catch {
      // leave empty
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadTargets(); }, []);

  const runProposal = async () => {
    setProposing(true);
    setError(null);
    try {
      const res = await fetch('/api/growth/propose-targets', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? 'Proposal failed');
      setProposals(data.proposals ?? []);
      setSignalSummary(data.signalSummary ?? null);
      setSelected(new Set());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProposing(false);
    }
  };

  const toggle = (handle: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(handle)) {
        next.delete(handle);
      } else if (next.size < CAP) {
        next.add(handle);
      }
      return next;
    });
  };

  const savePicks = async () => {
    if (!proposals) return;
    setSavingPicks(true);
    setError(null);
    try {
      const picked = proposals.filter(p => selected.has(p.handle));
      const res = await fetch('/api/growth/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets: picked.map(p => ({ ...p, source: 'claude' })) }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? 'Save failed');
      setTargets(data.targets ?? []);
      setProposals(null);
      setSignalSummary(null);
      setSelected(new Set());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingPicks(false);
    }
  };

  const cancelPicks = () => {
    setProposals(null);
    setSignalSummary(null);
    setSelected(new Set());
    setError(null);
  };

  const removeTarget = async (handle: string) => {
    if (!confirm(`Remove @${handle} from your targets?`)) return;
    const res = await fetch(`/api/growth/targets?handle=${encodeURIComponent(handle)}`, { method: 'DELETE' });
    if (res.ok) setTargets(prev => prev.filter(t => t.handle !== handle));
  };

  const toggleStatus = async (handle: string, status: 'active' | 'paused') => {
    const res = await fetch('/api/growth/targets', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle, patch: { status } }),
    });
    const data = await res.json();
    if (data.success) {
      setTargets(prev => prev.map(t => (t.handle === handle ? data.target : t)));
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────

  if (loading) {
    return <div className="text-center py-20 text-gray-600">Loading targets…</div>;
  }

  // Proposal picker view — user is choosing their 20 from Claude's list.
  if (proposals) {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between border-b border-gray-800 pb-3">
          <div>
            <h3 className="text-lg font-semibold">Pick your targets</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Claude proposed {proposals.length}. Choose up to {CAP}.
            </p>
          </div>
          <div className="text-sm">
            <span className="font-semibold text-white">{selected.size}</span>
            <span className="text-gray-500"> / {CAP} selected</span>
          </div>
        </div>

        {signalSummary && (
          <div className="text-xs text-gray-500 bg-gray-900/50 rounded-xl p-3 border border-gray-800">
            Based on: {signalSummary.tweetSamples} recent tweets ·{' '}
            {signalSummary.following} follows · {signalSummary.bookmarks} bookmarks ·{' '}
            {signalSummary.likes} likes
            {signalSummary.notes.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-amber-500/80">
                {signalSummary.notes.map((n, i) => <li key={i}>• {n}</li>)}
              </ul>
            )}
          </div>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="space-y-2">
          {proposals.map((p, i) => {
            const on = selected.has(p.handle);
            const disabled = !on && selected.size >= CAP;
            return (
              <button
                key={p.handle}
                type="button"
                onClick={() => toggle(p.handle)}
                disabled={disabled}
                className={`w-full text-left flex items-start gap-3 p-3 rounded-xl border transition-colors ${
                  on
                    ? 'bg-sky-500/10 border-sky-500/60'
                    : disabled
                      ? 'bg-gray-900/40 border-gray-800/50 opacity-40 cursor-not-allowed'
                      : 'bg-gray-900 border-gray-800 hover:border-gray-700 cursor-pointer'
                }`}
              >
                <span className="shrink-0 mt-0.5 text-sm">{on ? '☑' : '☐'}</span>
                <span className="shrink-0 text-xs text-gray-600 mt-0.5 tabular-nums w-6">#{i + 1}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-white truncate">
                    @{p.handle}
                  </span>
                  <span className="block text-xs text-gray-400 mt-0.5">{p.reason}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex gap-3 pt-2">
          <button
            onClick={savePicks}
            disabled={savingPicks || selected.size === 0}
            className="flex-1 cursor-pointer bg-sky-500 hover:bg-sky-400 disabled:bg-sky-900 disabled:opacity-50 disabled:cursor-not-allowed text-white py-3 rounded-xl font-semibold text-sm transition"
          >
            {savingPicks ? 'Saving…' : `Save ${selected.size} target${selected.size === 1 ? '' : 's'}`}
          </button>
          <button
            onClick={cancelPicks}
            disabled={savingPicks}
            className="cursor-pointer px-5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl text-sm font-medium transition disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Main view — either empty state (never proposed) or the saved target list.
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between border-b border-gray-800 pb-3">
        <div>
          <h3 className="text-lg font-semibold">Targets</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {targets.length} of {CAP} · accounts we reply-target for follower growth
          </p>
        </div>
        <button
          onClick={runProposal}
          disabled={proposing}
          className="cursor-pointer text-sm bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl font-medium transition"
        >
          {proposing ? 'Analyzing…' : targets.length === 0 ? '✨ Propose targets' : 'Refresh proposals'}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {targets.length === 0 ? (
        <div className="text-center py-16 text-gray-500 border border-dashed border-gray-800 rounded-2xl space-y-2">
          <p className="text-base">No targets yet.</p>
          <p className="text-sm text-gray-600">
            Hit <span className="text-gray-300">✨ Propose targets</span> — Claude will analyze your recent
            activity and suggest up to {CAP} accounts to target.
          </p>
          {proposing && (
            <p className="text-xs text-sky-400 mt-3 animate-pulse">
              Fetching your recent tweets, follows, bookmarks, and likes…
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {targets.map(t => (
              <div
                key={t.handle}
                className="bg-gray-900 border border-gray-800 rounded-xl p-3 flex items-start gap-3"
              >
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2">
                    <a
                      href={`https://x.com/${t.handle}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-semibold text-white hover:underline"
                    >
                      @{t.handle}
                    </a>
                    <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
                      t.status === 'active'
                        ? 'bg-green-500/15 text-green-400'
                        : 'bg-gray-800 text-gray-500'
                    }`}>
                      {t.status}
                    </span>
                  </span>
                  {t.reason && (
                    <span className="block text-xs text-gray-500 mt-1">{t.reason}</span>
                  )}
                </span>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => toggleStatus(t.handle, t.status === 'active' ? 'paused' : 'active')}
                    className="cursor-pointer text-xs px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition"
                  >
                    {t.status === 'active' ? 'Pause' : 'Resume'}
                  </button>
                  <button
                    onClick={() => removeTarget(t.handle)}
                    className="cursor-pointer text-xs px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-red-900/40 text-gray-500 hover:text-red-400 transition"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="text-xs text-gray-600 border-t border-gray-800 pt-4">
            Reply/quote-tweet drafts against these targets will appear in a Queue
            here — landing in the next build step.
          </div>
        </>
      )}
    </div>
  );
}
