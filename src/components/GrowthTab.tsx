'use client';

import { useEffect, useState, useCallback } from 'react';
import type { StoredTarget, StoredCandidate } from '@/store/store-shared';

type Proposal = { handle: string; reason: string };
type SignalSummary = {
  tweetSamples: number;
  following: number;
  bookmarks: number;
  likes: number;
  notes: string[];
};
type BudgetSnapshot = { date: string; used: number; limit: number };
type ScanReport = {
  targetsConsidered: number;
  targetsScanned: number;
  candidatesCreated: number;
  candidatesSkipped: number;
  notes: string[];
  quietSkipped: boolean;
};

const CAP = 20;

export function GrowthTab() {
  const [subTab, setSubTab] = useState<'queue' | 'targets'>('queue');
  const [error, setError] = useState<string | null>(null);

  // Targets state
  const [targets, setTargets] = useState<StoredTarget[]>([]);
  const [loadingTargets, setLoadingTargets] = useState(true);

  // Queue state
  const [candidates, setCandidates] = useState<StoredCandidate[]>([]);
  const [budget, setBudget] = useState<BudgetSnapshot | null>(null);
  const [loadingQueue, setLoadingQueue] = useState(true);

  // Proposal / picker state
  const [proposing, setProposing] = useState(false);
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [signalSummary, setSignalSummary] = useState<SignalSummary | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [savingPicks, setSavingPicks] = useState(false);

  // Scan state
  const [scanning, setScanning] = useState(false);
  const [scanReport, setScanReport] = useState<ScanReport | null>(null);

  // Per-candidate action state
  const [actingId, setActingId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});

  // ─── Loaders ─────────────────────────────────────────────────────────

  const loadTargets = useCallback(async () => {
    try {
      const res = await fetch('/api/growth/targets');
      const data = await res.json();
      if (data.success) setTargets(data.targets ?? []);
    } catch { /* keep empty */ }
    finally { setLoadingTargets(false); }
  }, []);

  const loadQueue = useCallback(async () => {
    try {
      const res = await fetch('/api/growth/candidates');
      const data = await res.json();
      if (data.success) {
        setCandidates(data.pending ?? []);
        setBudget(data.budget ?? null);
      }
    } catch { /* keep empty */ }
    finally { setLoadingQueue(false); }
  }, []);

  useEffect(() => { loadTargets(); loadQueue(); }, [loadTargets, loadQueue]);

  // ─── Proposal picker (unchanged core, kept in this file for locality) ─

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
      if (next.has(handle)) next.delete(handle);
      else if (next.size < CAP) next.add(handle);
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
    setProposals(null); setSignalSummary(null); setSelected(new Set()); setError(null);
  };

  // ─── Target list actions ─────────────────────────────────────────────

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
    if (data.success) setTargets(prev => prev.map(t => (t.handle === handle ? data.target : t)));
  };

  // ─── Scan trigger ────────────────────────────────────────────────────

  const scanNow = async () => {
    setScanning(true);
    setError(null);
    setScanReport(null);
    try {
      const res = await fetch('/api/growth/scan', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? 'Scan failed');
      setScanReport(data.report);
      await loadQueue();
      await loadTargets(); // lastScannedAt refreshed
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  };

  // ─── Queue actions ───────────────────────────────────────────────────

  const approveCandidate = async (c: StoredCandidate) => {
    setActingId(c.id);
    setError(null);
    try {
      const draft = edits[c.id] ?? c.draft;
      const res = await fetch(`/api/growth/candidates/${encodeURIComponent(c.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', draft }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? 'Approve failed');
      setEdits(prev => { const n = { ...prev }; delete n[c.id]; return n; });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActingId(null);
      // Refresh even on failure so the stale card disappears and we don't
      // hit "Candidate already failed" on subsequent clicks.
      await loadQueue();
    }
  };

  const rejectCandidate = async (c: StoredCandidate) => {
    setActingId(c.id);
    setError(null);
    try {
      const res = await fetch(`/api/growth/candidates/${encodeURIComponent(c.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? 'Reject failed');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActingId(null);
      await loadQueue();
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────

  // Proposal picker view — takes over the tab while active.
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
            Based on: {signalSummary.tweetSamples} recent tweets · {signalSummary.following} follows ·{' '}
            {signalSummary.bookmarks} bookmarks · {signalSummary.likes} likes
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
                  <span className="block text-sm font-semibold text-white truncate">@{p.handle}</span>
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

  return (
    <div className="space-y-5">
      {/* Sub-tab toggle */}
      <div className="flex items-center gap-6 border-b border-gray-800">
        <button
          onClick={() => setSubTab('queue')}
          className={`cursor-pointer pb-3 -mb-px text-sm font-semibold transition-colors border-b-2 whitespace-nowrap ${
            subTab === 'queue' ? 'border-sky-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          Queue {candidates.length > 0 && <span className="ml-1 text-sky-400">({candidates.length})</span>}
        </button>
        <button
          onClick={() => setSubTab('targets')}
          className={`cursor-pointer pb-3 -mb-px text-sm font-semibold transition-colors border-b-2 whitespace-nowrap ${
            subTab === 'targets' ? 'border-sky-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          Targets <span className="ml-1 text-gray-600">({targets.length})</span>
        </button>
        {budget && (
          <span className="ml-auto text-xs text-gray-500 tabular-nums">
            <span className="text-white font-semibold">{budget.used}</span>
            <span> / {budget.limit} actions today</span>
          </span>
        )}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {subTab === 'queue' ? (
        <QueueView
          candidates={candidates}
          loading={loadingQueue}
          hasTargets={targets.length > 0}
          scanning={scanning}
          scanReport={scanReport}
          actingId={actingId}
          edits={edits}
          onEditChange={(id, v) => setEdits(prev => ({ ...prev, [id]: v }))}
          onScan={scanNow}
          onApprove={approveCandidate}
          onReject={rejectCandidate}
        />
      ) : (
        <TargetsView
          targets={targets}
          loading={loadingTargets}
          proposing={proposing}
          onProposal={runProposal}
          onRemove={removeTarget}
          onToggleStatus={toggleStatus}
        />
      )}
    </div>
  );
}

// ─── Queue view ────────────────────────────────────────────────────────

function QueueView(props: {
  candidates: StoredCandidate[];
  loading: boolean;
  hasTargets: boolean;
  scanning: boolean;
  scanReport: ScanReport | null;
  actingId: string | null;
  edits: Record<string, string>;
  onEditChange: (id: string, v: string) => void;
  onScan: () => void;
  onApprove: (c: StoredCandidate) => void;
  onReject: (c: StoredCandidate) => void;
}) {
  const { candidates, loading, hasTargets, scanning, scanReport, actingId, edits, onEditChange, onScan, onApprove, onReject } = props;

  if (loading) return <div className="text-center py-16 text-gray-600">Loading queue…</div>;

  if (!hasTargets) {
    return (
      <div className="text-center py-16 text-gray-500 border border-dashed border-gray-800 rounded-2xl space-y-2">
        <p className="text-base">Add targets first.</p>
        <p className="text-sm text-gray-600">Switch to the Targets tab and hit Propose to get started.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {candidates.length === 0 ? 'No pending drafts right now.' : `${candidates.length} draft${candidates.length === 1 ? '' : 's'} awaiting approval`}
        </p>
        <button
          onClick={onScan}
          disabled={scanning}
          className="cursor-pointer text-sm bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl font-medium transition"
        >
          {scanning ? 'Scanning…' : '🔎 Scan now'}
        </button>
      </div>

      {scanReport && (
        <div className="text-xs text-gray-500 bg-gray-900/50 rounded-xl p-3 border border-gray-800">
          {scanReport.quietSkipped
            ? 'Quiet hours — scan deferred.'
            : `Scanned ${scanReport.targetsScanned} of ${scanReport.targetsConsidered} targets · ${scanReport.candidatesCreated} draft${scanReport.candidatesCreated === 1 ? '' : 's'} created · ${scanReport.candidatesSkipped} skipped`}
          {scanReport.notes.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-gray-600">
              {scanReport.notes.map((n, i) => <li key={i}>• {n}</li>)}
            </ul>
          )}
        </div>
      )}

      {candidates.length === 0 ? (
        <div className="text-center py-12 text-gray-600 border border-dashed border-gray-800 rounded-2xl">
          <p className="text-sm">Hit <span className="text-gray-400">🔎 Scan now</span> to check targets for fresh tweets to reply to.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {candidates.map(c => (
            <CandidateCard
              key={c.id}
              c={c}
              acting={actingId === c.id}
              draftValue={edits[c.id] ?? c.draft}
              onEdit={v => onEditChange(c.id, v)}
              onApprove={() => onApprove(c)}
              onReject={() => onReject(c)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CandidateCard(props: {
  c: StoredCandidate;
  acting: boolean;
  draftValue: string;
  onEdit: (v: string) => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const { c, acting, draftValue, onEdit, onApprove, onReject } = props;
  const len = draftValue.length;
  const overLimit = len > 280;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <a
            href={`https://x.com/${c.targetHandle}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-white hover:underline"
          >
            @{c.targetHandle}
          </a>
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 uppercase tracking-wider">
            {c.action === 'reply' ? 'Reply' : 'Quote'}
          </span>
        </div>
        <a
          href={c.sourceTweetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-gray-500 hover:text-sky-400"
        >
          view original ↗
        </a>
      </div>

      {/* Original tweet — quoted context */}
      <div className="text-sm text-gray-300 border-l-2 border-gray-700 pl-3 whitespace-pre-wrap">
        {c.sourceTweetText}
      </div>
      <p className="text-[11px] text-gray-600 -mt-2">
        {c.sourceLikeCount ?? 0} likes · {c.sourceReplyCount ?? 0} replies · {c.sourceRetweetCount ?? 0} reposts
      </p>

      {/* Draft — editable */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Draft {c.action === 'reply' ? 'reply' : 'quote-tweet'}
          </label>
          <span className={`text-xs tabular-nums ${overLimit ? 'text-red-400 font-semibold' : len > 260 ? 'text-yellow-400' : 'text-gray-500'}`}>
            {len}/280
          </span>
        </div>
        <textarea
          value={draftValue}
          onChange={e => onEdit(e.target.value)}
          disabled={acting}
          rows={4}
          className={`w-full bg-gray-800 rounded-xl p-3 text-white text-sm leading-relaxed resize-y border transition-colors outline-none disabled:opacity-60 disabled:cursor-not-allowed ${
            overLimit ? 'border-red-500/60 focus:border-red-500' : 'border-gray-700 focus:border-sky-500'
          }`}
        />
        {c.reasoning && (
          <p className="text-xs text-gray-500 italic mt-2">— {c.reasoning}</p>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={onApprove}
          disabled={acting || overLimit || !draftValue.trim()}
          className="flex-1 cursor-pointer bg-sky-500 hover:bg-sky-400 disabled:bg-sky-900 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2.5 rounded-xl font-semibold text-sm transition"
        >
          {acting ? 'Posting…' : '🚀 Approve & Post'}
        </button>
        <button
          onClick={onReject}
          disabled={acting}
          className="cursor-pointer px-5 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white rounded-xl text-sm font-medium transition disabled:opacity-40"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

// ─── Targets view (essentially the previous main view) ────────────────

function TargetsView(props: {
  targets: StoredTarget[];
  loading: boolean;
  proposing: boolean;
  onProposal: () => void;
  onRemove: (handle: string) => void;
  onToggleStatus: (handle: string, status: 'active' | 'paused') => void;
}) {
  const { targets, loading, proposing, onProposal, onRemove, onToggleStatus } = props;

  if (loading) return <div className="text-center py-16 text-gray-600">Loading targets…</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          {targets.length} of {CAP} · accounts we reply-target for follower growth
        </p>
        <button
          onClick={onProposal}
          disabled={proposing}
          className="cursor-pointer text-sm bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl font-medium transition"
        >
          {proposing ? 'Analyzing…' : targets.length === 0 ? '✨ Propose targets' : 'Refresh proposals'}
        </button>
      </div>

      {targets.length === 0 ? (
        <div className="text-center py-16 text-gray-500 border border-dashed border-gray-800 rounded-2xl space-y-2">
          <p className="text-base">No targets yet.</p>
          <p className="text-sm text-gray-600">
            Hit <span className="text-gray-300">✨ Propose targets</span> — Claude will analyze your recent
            activity and suggest up to {CAP} accounts.
          </p>
          {proposing && (
            <p className="text-xs text-sky-400 mt-3 animate-pulse">
              Fetching your recent tweets, follows, bookmarks, and likes…
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {targets.map(t => (
            <div key={t.handle} className="bg-gray-900 border border-gray-800 rounded-xl p-3 flex items-start gap-3">
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
                    t.status === 'active' ? 'bg-green-500/15 text-green-400' : 'bg-gray-800 text-gray-500'
                  }`}>{t.status}</span>
                </span>
                {t.reason && <span className="block text-xs text-gray-500 mt-1">{t.reason}</span>}
                {t.lastScannedAt && (
                  <span className="block text-[10px] text-gray-600 mt-0.5">
                    last scan {relative(t.lastScannedAt)}
                  </span>
                )}
              </span>
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => onToggleStatus(t.handle, t.status === 'active' ? 'paused' : 'active')}
                  className="cursor-pointer text-xs px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition"
                >
                  {t.status === 'active' ? 'Pause' : 'Resume'}
                </button>
                <button
                  onClick={() => onRemove(t.handle)}
                  className="cursor-pointer text-xs px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-red-900/40 text-gray-500 hover:text-red-400 transition"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function relative(iso: string): string {
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86_400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86_400)}d ago`;
}
