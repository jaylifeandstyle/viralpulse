'use client';

import { useState, useEffect, useCallback } from 'react';
import { GalaxyOutput, GrowthMode } from '@/shared/types';
import { ForYouFeed } from '@/components/ForYouFeed';
import type { AccountOption } from '@/lib/x-accounts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Opportunity = {
  id: string;
  topic: string;
  viralityScore: number;
  confidence: number;
  optimalPostTime: string;
  draft: string;
  contentAngle: string;
  imageSearchQuery: string;
  /** og:image from the source article — pre-fills Post Now modal */
  imageUrl?: string;
  /** Galaxy.07: up to 2 pre-loaded images */
  imageUrls?: string[];
  /** Galaxy.07: direct MP4 for video posts */
  videoUrl?: string;
  galaxyId?: string;
  reasoning: string;
  hashtagSuggestions: string[];
  shouldAct: boolean;
  roiEstimate: 'high' | 'medium' | 'low';
  source: 'detector' | 'manual';
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_TOPICS = [
  'Apple AI Announcement',
  'Elon Musk xAI update',
  'Trump policy announcement',
  'Major crypto regulation news',
  'Breaking: New iPhone feature leak',
  'AI model breakthrough from OpenAI',
  'Federal Reserve interest rate decision',
  'Google antitrust ruling',
];

const POLL_INTERVAL_MS = 10_000;

const SHOW_DEV_UI = process.env.NEXT_PUBLIC_SHOW_DEV_UI === 'true';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scoreColor(score: number) {
  if (score >= 70) return 'text-green-400';
  if (score >= 45) return 'text-yellow-400';
  return 'text-gray-400';
}

function roiBadgeStyle(roi: string) {
  if (roi === 'high') return 'bg-green-500/15 text-green-400';
  if (roi === 'medium') return 'bg-yellow-500/15 text-yellow-400';
  return 'bg-gray-700 text-gray-400';
}

function formatPostTime(t: string) {
  const map: Record<string, string> = {
    now: 'Post now',
    '15min': 'Post in 15 min',
    '30min': 'Post in 30 min',
    '1hr': '1 hr window',
    '2hr': '2 hr window',
    skip: 'Monitor only',
    live: 'Live',
  };
  return map[t] ?? t;
}

function charCountColor(len: number) {
  if (len > 280) return 'text-red-400 font-semibold';
  if (len > 260) return 'text-yellow-400';
  return 'text-gray-500';
}

function googleImagesUrl(query: string) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=isch`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type GalaxyId = 'galaxy.01' | 'galaxy.02' | 'galaxy.03' | 'galaxy.04' | 'galaxy.05' | 'galaxy.07';

export default function Dashboard() {
  const [activeGalaxy, setActiveGalaxy] = useState<GalaxyId>('galaxy.02');
  const [mode, setMode] = useState<GrowthMode>('pure_growth');
  const [aggressiveness, setAggressiveness] = useState(7);
  const [feedTab, setFeedTab] = useState<'opportunities' | 'foryou'>('opportunities');
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [trendsPolling, setTrendsPolling] = useState(false);
  const [detectorActive, setDetectorActive] = useState(false);

  // ── Post Now state (independent of Craft & Copy modal — they don't share)
  const [postingOpportunity, setPostingOpportunity] = useState<Opportunity | null>(null);
  const [postingText, setPostingText] = useState('');
  const [postingImageUrl, setPostingImageUrl] = useState('');
  const [postingImageUrl2, setPostingImageUrl2] = useState('');
  const [postingVideoUrl, setPostingVideoUrl] = useState('');
  const [postingInFlight, setPostingInFlight] = useState(false);
  const [postingConfigured, setPostingConfigured] = useState<boolean | null>(null);
  // Accounts the app can post AS (owner / brand), and which are selected.
  const [postAccounts, setPostAccounts] = useState<AccountOption[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);

  // Light probe — checks whether X access tokens are configured so we can
  // show the user a helpful message instead of letting them tap a dead button.
  // Also pulls the list of post-able accounts for the Post Now selector.
  useEffect(() => {
    fetch('/api/post-to-x')
      .then(r => r.json())
      .then(d => {
        setPostingConfigured(!!d.configured);
        const accts: AccountOption[] = d.accounts ?? [];
        setPostAccounts(accts);
        // Default selection: owner only (or the first account available).
        const owner = accts.find(a => a.id === 'owner') ?? accts[0];
        setSelectedAccounts(owner ? [owner.id] : []);
      })
      .catch(() => setPostingConfigured(false));
  }, []);

  // Sync active galaxy with the server on mount
  useEffect(() => {
    fetch('/api/active-galaxy')
      .then(r => r.json())
      .then(d => { if (d.success) setActiveGalaxy(d.activeGalaxy); })
      .catch(() => {});
  }, []);

  // Push the user's choice back to the server's Brain
  const handleGalaxyChange = async (id: GalaxyId) => {
    setActiveGalaxy(id);
    try {
      await fetch('/api/active-galaxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ galaxyId: id }),
      });
    } catch {
      // Silent — state will resync next load
    }
  };

  const fetchTrends = async () => {
    setTrendsPolling(true);
    try {
      const res = await fetch('/api/galaxy03-trends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? 'Trends fetch failed');
      await pollDetector();
    } catch (err: any) {
      alert(`Trends fetch error: ${err.message}`);
    } finally {
      setTrendsPolling(false);
    }
  };

  const [selectedOpportunity, setSelectedOpportunity] = useState<Opportunity | null>(null);
  const [draftText, setDraftText] = useState('');

  // ---------------------------------------------------------------------------
  // Poll /api/opportunities for live detections
  // ---------------------------------------------------------------------------
  const pollDetector = useCallback(async () => {
    try {
      const res = await fetch('/api/opportunities');
      if (!res.ok) return;
      const data = await res.json();
      if (!data.success || !data.opportunities?.length) return;

      setDetectorActive(true);
      setOpportunities(prev => {
        const existingIds = new Set(prev.map(o => o.id));
        const newOnes: Opportunity[] = data.opportunities
          .filter((o: any) => !existingIds.has(o.id))
          .map((o: any): Opportunity => ({
            id: o.id,
            topic: o.topic,
            viralityScore: o.viralityScore,
            confidence: o.confidence,
            optimalPostTime: o.optimalPostTime ?? 'live',
            draft: o.draft ?? '',
            contentAngle: o.contentAngle ?? '',
            imageSearchQuery: o.imageSearchQuery ?? '',
            imageUrl: o.imageUrl || undefined,
            imageUrls: o.imageUrls || undefined,
            videoUrl: o.videoUrl || undefined,
            galaxyId: o.galaxyId || undefined,
            reasoning: o.reasoning ?? '',
            hashtagSuggestions: o.hashtagSuggestions ?? [],
            shouldAct: o.shouldAct,
            roiEstimate: o.roiEstimate,
            source: 'detector',
          }));
        if (!newOnes.length) return prev;
        return [...newOnes, ...prev];
      });
    } catch {
      // Silent — detector may not be running
    }
  }, []);

  useEffect(() => {
    pollDetector();
    const id = setInterval(pollDetector, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [pollDetector]);

  // ---------------------------------------------------------------------------
  // Manual simulate
  // ---------------------------------------------------------------------------
  const generateOpportunity = async () => {
    setLoading(true);
    try {
      const topic = TEST_TOPICS[Math.floor(Math.random() * TEST_TOPICS.length)];
      const signals = {
        topic,
        velocity: Math.floor(Math.random() * 200) + 100,
        acceleration: Math.floor(Math.random() * 150) + 50,
        avgEngagement: Math.floor(Math.random() * 2000) + 500,
        trending: Math.random() > 0.5,
        samplePosts: [],
        timestamp: new Date().toISOString(),
      };
      const userPrefs = {
        userId: 'current-user',
        mode,
        aggressiveness,
        weeklyFollowerTarget: 1000,
        niches: ['breaking news', 'politics', 'technology', 'AI', 'business'],
      };

      const res = await fetch('/api/generate-opportunity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signals, userPrefs }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? 'Unknown error');

      const result: GalaxyOutput = data.result;
      const newOpp: Opportunity = {
        id: Date.now().toString(),
        topic,
        viralityScore: result.viralityScore ?? 0,
        confidence: result.confidence ?? 0,
        optimalPostTime: result.optimalPostTime ?? 'now',
        draft: result.draftTweet ?? '',
        contentAngle: result.contentAngle ?? '',
        imageSearchQuery: result.imageSearchQuery ?? '',
        reasoning: result.reasoning ?? '',
        hashtagSuggestions: result.hashtagSuggestions ?? [],
        shouldAct: result.shouldAct ?? false,
        roiEstimate: result.roiEstimate ?? 'low',
        source: 'manual',
      };
      setOpportunities(prev => [newOpp, ...prev]);
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Force poll
  // ---------------------------------------------------------------------------
  const forcePoll = async () => {
    setPolling(true);
    try {
      const res = await fetch('/api/force-poll', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? 'Poll failed');
      await pollDetector();
    } catch (err: any) {
      alert(`Force poll error: ${err.message}`);
    } finally {
      setPolling(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Modal
  // ---------------------------------------------------------------------------
  const openDraftModal = (opp: Opportunity) => {
    setSelectedOpportunity(opp);
    setDraftText(opp.draft);
  };

  const closeModal = () => {
    setSelectedOpportunity(null);
    setDraftText('');
  };

  const appendHashtag = (tag: string) => {
    const cleaned = tag.startsWith('#') ? tag : `#${tag}`;
    setDraftText(prev => {
      const sep = prev.endsWith('\n') || prev === '' ? '' : ' ';
      return prev + sep + cleaned;
    });
  };

  const approveDraft = async () => {
    if (!selectedOpportunity || !draftText) return;
    try {
      await navigator.clipboard.writeText(draftText);
      if (selectedOpportunity.source === 'detector') {
        fetch(`/api/opportunities?id=${selectedOpportunity.id}`, { method: 'DELETE' }).catch(() => {});
      }
      alert('✅ Draft copied to clipboard!\n\nPaste and post it on X.');
      setOpportunities(prev => prev.filter(o => o.id !== selectedOpportunity.id));
      closeModal();
    } catch {
      alert('Failed to copy. Please select and copy the text manually.');
    }
  };

  const handlePass = (opp: Opportunity) => {
    if (opp.source === 'detector') {
      fetch(`/api/opportunities?id=${opp.id}`, { method: 'DELETE' }).catch(() => {});
    }
    setOpportunities(prev => prev.filter(o => o.id !== opp.id));
  };

  // ─── Post Now handlers ─────────────────────────────────────────────────
  // Open a dedicated confirmation modal (NOT the Craft & Copy modal — kept
  // separate so the existing flow is untouched).
  const openPostConfirm = (opp: Opportunity) => {
    if (postingConfigured === false) {
      alert(
        'X posting is not configured.\n\n' +
        'Add these to .env.local then restart npm run dev:\n' +
        '  X_ACCESS_TOKEN=...\n' +
        '  X_ACCESS_TOKEN_SECRET=...\n\n' +
        'Generate them at developer.twitter.com → your project → Keys and tokens → ' +
        '"Access Token and Secret". Your app must have Read+Write permissions.',
      );
      return;
    }
    setPostingOpportunity(opp);
    setPostingText(opp.draft);
    const imgs = opp.imageUrls?.length
      ? opp.imageUrls
      : opp.imageUrl
        ? [opp.imageUrl]
        : [];
    setPostingImageUrl(imgs[0] ?? '');
    setPostingImageUrl2(imgs[1] ?? '');
    setPostingVideoUrl(opp.videoUrl ?? '');
  };

  const closePostConfirm = () => {
    if (postingInFlight) return;
    setPostingOpportunity(null);
    setPostingText('');
    setPostingImageUrl('');
    setPostingImageUrl2('');
    setPostingVideoUrl('');
  };

  const confirmPostNow = async () => {
    if (!postingOpportunity) return;
    const text = postingText.trim();
    if (!text) {
      alert('Tweet text is empty.');
      return;
    }
    if (text.length > 280) {
      alert(`Tweet is ${text.length} characters — max 280. Trim before posting.`);
      return;
    }

    if (selectedAccounts.length === 0) {
      alert('Pick at least one account to post to.');
      return;
    }

    setPostingInFlight(true);
    try {
      const isG07 = postingOpportunity.galaxyId === 'galaxy.07';
      const imageUrls = [postingImageUrl.trim(), postingImageUrl2.trim()].filter(Boolean);
      const res = await fetch('/api/post-to-x', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          imageUrl: !isG07 && postingImageUrl.trim() ? postingImageUrl.trim() : undefined,
          imageUrls: isG07 && imageUrls.length ? imageUrls : undefined,
          videoUrl: postingVideoUrl.trim() || undefined,
          oppId: postingOpportunity.source === 'detector' ? postingOpportunity.id : undefined,
          accounts: selectedAccounts,
        }),
      });
      const data = await res.json();
      const results: { handle: string; ok: boolean; url?: string; error?: string }[] =
        data.results ?? [];

      if (!res.ok || !data.success) {
        // Surface per-account errors when present, else a generic message.
        const detail = results.length
          ? results.map(r => `@${r.handle}: ${r.ok ? 'ok' : r.error}`).join('\n')
          : (data.error ?? 'Unknown error');
        throw new Error(detail);
      }

      // Remove the opp from the local feed AFTER server confirms a tweet sent
      setOpportunities(prev => prev.filter(o => o.id !== postingOpportunity.id));
      setPostingOpportunity(null);
      setPostingText('');
      setPostingImageUrl('');
      setPostingImageUrl2('');
      setPostingVideoUrl('');

      const ok = results.filter(r => r.ok);
      const failed = results.filter(r => !r.ok);
      let msg = `✅ Posted to ${ok.map(r => '@' + r.handle).join(', ')}.`;
      if (ok[0]?.url) msg += `\n\n${ok[0].url}`;
      if (failed.length) msg += `\n\n⚠️ Failed: ${failed.map(r => '@' + r.handle + ' (' + r.error + ')').join(', ')}`;
      alert(msg);
    } catch (err: any) {
      alert(`❌ Post failed:\n\n${err.message ?? err}`);
    } finally {
      setPostingInFlight(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const liveCount = opportunities.filter(o => o.source === 'detector').length;
  const actNowCount = opportunities.filter(o => o.shouldAct).length;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-7xl mx-auto px-6 py-8">

        {/* ── Header ── */}
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <div className="flex items-center gap-3">
            {detectorActive && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 text-green-400 rounded-full text-xs font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                Detector live
              </div>
            )}
            {SHOW_DEV_UI && (
              <div className="px-3 py-1.5 bg-gray-800 rounded-full text-xs text-gray-400">
                {activeGalaxy}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-12 gap-6">

          {/* ── Left Sidebar — Controls ── */}
          <div className="col-span-3 space-y-6">
            {SHOW_DEV_UI && (
            <div className="bg-gray-900 rounded-2xl p-5">
              <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-5">Controls</h2>
              <div className="space-y-6">

                <div>
                  <label className="text-xs text-gray-500 block mb-2">Active Galaxy</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {([
                      { id: 'galaxy.01' as GalaxyId, label: '01', hint: 'Aggressive' },
                      { id: 'galaxy.02' as GalaxyId, label: '02', hint: 'Selective' },
                      { id: 'galaxy.03' as GalaxyId, label: '03', hint: 'Trends · cheap' },
                      { id: 'galaxy.04' as GalaxyId, label: '04', hint: 'Diverse News · cheap' },
                      { id: 'galaxy.05' as GalaxyId, label: '05', hint: 'X Trends-first · auto-post' },
                      { id: 'galaxy.07' as GalaxyId, label: '07', hint: 'Cross-platform · Pure Growth' },
                    ]).map(g => (
                      <button
                        key={g.id}
                        onClick={() => handleGalaxyChange(g.id)}
                        title={g.hint}
                        className={`py-2 rounded-lg text-xs font-semibold transition-all ${
                          activeGalaxy === g.id
                            ? 'bg-white text-black'
                            : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
                        }`}
                      >
                        {g.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-gray-600 mt-1.5 leading-snug">
                    {activeGalaxy === 'galaxy.01' && 'Maximum reach. Sonnet 4.6.'}
                    {activeGalaxy === 'galaxy.02' && 'Selective journalist. Sonnet 4.6.'}
                    {activeGalaxy === 'galaxy.03' && 'X Trends API. Haiku 4.5.'}
                    {activeGalaxy === 'galaxy.04' && 'Diverse BBC News. Haiku 4.5.'}
                    {activeGalaxy === 'galaxy.05' && 'Rising X trends + discourse angles. Skips G04 dupes.'}
                    {activeGalaxy === 'galaxy.07' && 'Reddit + HN fusion. Pure Growth hooks for X.'}
                  </p>
                </div>

                <div>
                  <label className="text-xs text-gray-500 block mb-2">Growth Mode</label>
                  <div className="flex gap-2">
                    {(['pure_growth', 'niche_loyal'] as GrowthMode[]).map(m => (
                      <button
                        key={m}
                        onClick={() => setMode(m)}
                        className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                          mode === m
                            ? 'bg-white text-black'
                            : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
                        }`}
                      >
                        {m === 'pure_growth' ? 'Pure Growth' : 'Niche Loyal'}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex justify-between mb-2">
                    <label className="text-xs text-gray-500">Aggressiveness</label>
                    <span className="text-xs font-semibold text-white">{aggressiveness}/10</span>
                  </div>
                  <input
                    type="range" min="1" max="10" value={aggressiveness}
                    onChange={e => setAggressiveness(Number(e.target.value))}
                    className="w-full accent-white"
                  />
                </div>

                <div className="space-y-2">
                  <button
                    onClick={generateOpportunity}
                    disabled={loading}
                    className="w-full bg-white text-black py-3 rounded-xl font-semibold transition text-sm hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {loading ? 'Analyzing…' : '⚡ Simulate'}
                  </button>
                  <button
                    onClick={forcePoll}
                    disabled={polling}
                    className="w-full bg-gray-800 text-gray-200 py-2.5 rounded-xl font-medium transition text-sm hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed border border-gray-700"
                  >
                    {polling ? 'Polling X…' : '🔄 Force Poll Now'}
                  </button>
                  <button
                    onClick={fetchTrends}
                    disabled={trendsPolling}
                    className="w-full bg-gray-800 text-gray-200 py-2.5 rounded-xl font-medium transition text-sm hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed border border-gray-700"
                    title="Fetch live X Trends and analyze with Galaxy.03"
                  >
                    {trendsPolling ? 'Fetching trends…' : '📈 Pull X Trends'}
                  </button>
                  <p className="text-xs text-gray-600 text-center pt-1">
                    or run <code className="text-gray-500">npm run detect</code>
                  </p>
                </div>

              </div>
            </div>
            )}

            {/* Stats */}
            <div className="bg-gray-900 rounded-2xl p-5 space-y-4">
              <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Session</h2>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Total</span>
                  <span className="font-medium">{opportunities.length}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Live detected</span>
                  <span className="text-green-400 font-medium">{liveCount}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Act Now</span>
                  <span className="text-yellow-400 font-medium">{actNowCount}</span>
                </div>
              </div>
              {SHOW_DEV_UI && (
                <div className="border-t border-gray-800 pt-4">
                  <p className="text-xs text-gray-600 leading-relaxed">
                    Detector polls X every 20 min.<br />
                    Dashboard refreshes every 10 s.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ── Main Feed ── */}
          <div className="col-span-9">
            {/* Feed toggle */}
            <div className="flex items-center gap-6 mb-5 border-b border-gray-800">
              <button
                onClick={() => setFeedTab('opportunities')}
                className={`cursor-pointer pb-3 -mb-px text-sm font-semibold transition-colors border-b-2 ${
                  feedTab === 'opportunities'
                    ? 'border-sky-500 text-white'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                Hot Opportunities
              </button>
              <button
                onClick={() => setFeedTab('foryou')}
                className={`cursor-pointer pb-3 -mb-px text-sm font-semibold transition-colors border-b-2 ${
                  feedTab === 'foryou'
                    ? 'border-sky-500 text-white'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                For You
              </button>
              {feedTab === 'opportunities' && (
                <span className="ml-auto text-sm text-gray-500">{opportunities.length} active</span>
              )}
            </div>

            {feedTab === 'foryou' ? (
              <ForYouFeed />
            ) : opportunities.length === 0 ? (
              <div className="text-center py-20 text-gray-600 border border-dashed border-gray-800 rounded-2xl space-y-3">
                <p className="text-lg">No opportunities yet.</p>
                {SHOW_DEV_UI ? (
                  <p className="text-sm">
                    Click <span className="text-gray-300">⚡ Simulate</span> to test with sample signals,
                    <br />or <span className="text-gray-300">🔄 Force Poll Now</span> to hit the X API live.
                  </p>
                ) : (
                  <p className="text-sm">Check back soon — new stories drop every hour.</p>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {opportunities.map(opp => (
                  <OpportunityCard
                    key={opp.id}
                    opp={opp}
                    onCraft={() => openDraftModal(opp)}
                    onPostNow={() => openPostConfirm(opp)}
                    onPass={() => handlePass(opp)}
                  />
                ))}
              </div>
            )}
          </div>

        </div>
      </div>

      {/* ── Draft Modal ── */}
      {selectedOpportunity && (
        <DraftModal
          opp={selectedOpportunity}
          draftText={draftText}
          onDraftChange={setDraftText}
          onAppendHashtag={appendHashtag}
          onApprove={approveDraft}
          onClose={closeModal}
        />
      )}

      {/* ── Post Now Confirmation Modal ── */}
      {postingOpportunity && (
        <PostConfirmModal
          opp={postingOpportunity}
          text={postingText}
          imageUrl={postingImageUrl}
          imageUrl2={postingImageUrl2}
          videoUrl={postingVideoUrl}
          inFlight={postingInFlight}
          accounts={postAccounts}
          selectedAccounts={selectedAccounts}
          onToggleAccount={(id) =>
            setSelectedAccounts(prev =>
              prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
            )
          }
          onTextChange={setPostingText}
          onImageUrlChange={setPostingImageUrl}
          onImageUrl2Change={setPostingImageUrl2}
          onVideoUrlChange={setPostingVideoUrl}
          onConfirm={confirmPostNow}
          onCancel={closePostConfirm}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OpportunityCard
// ---------------------------------------------------------------------------

function OpportunityCard({
  opp,
  onCraft,
  onPostNow,
  onPass,
}: {
  opp: Opportunity;
  onCraft: () => void;
  onPostNow: () => void;
  onPass: () => void;
}) {
  return (
    <div
      className={`bg-gray-900 rounded-2xl p-6 border transition-colors ${
        opp.shouldAct
          ? 'border-green-500/40 hover:border-green-500/70'
          : 'border-gray-800 hover:border-gray-700'
      }`}
    >
      {/* Top row: badges + score */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex-1 min-w-0">
          {/* Badge row */}
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {opp.source === 'detector' && (
              <span className="flex items-center gap-1 px-2 py-0.5 bg-green-500/10 text-green-400 rounded-full text-xs font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                Live
              </span>
            )}
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
              opp.shouldAct
                ? 'bg-green-500/15 text-green-300'
                : 'bg-gray-800 text-gray-400'
            }`}>
              {opp.shouldAct ? '⚡ Act Now' : '👁 Monitor'}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${roiBadgeStyle(opp.roiEstimate)}`}>
              {opp.roiEstimate.toUpperCase()} ROI
            </span>
            {opp.optimalPostTime && opp.optimalPostTime !== 'skip' && (
              <span className="text-xs text-gray-500">{formatPostTime(opp.optimalPostTime)}</span>
            )}
          </div>
          {/* Topic */}
          <h3 className="text-lg font-bold text-white leading-tight">{opp.topic}</h3>
        </div>

        {/* Score */}
        <div className="text-right shrink-0">
          <div className={`text-4xl font-black tabular-nums ${scoreColor(opp.viralityScore)}`}>
            {opp.viralityScore}
          </div>
          <div className="text-xs text-gray-600 mt-0.5">virality</div>
          <div className="text-sm text-gray-500 mt-1">{opp.confidence}% conf</div>
        </div>
      </div>

      {/* Content angle */}
      {opp.contentAngle && (
        <p className="text-sm text-blue-400 mb-3 leading-snug">
          <span className="text-gray-600 text-xs uppercase tracking-wider mr-1.5">Angle</span>
          {opp.contentAngle}
        </p>
      )}

      {/* Draft tweet */}
      {opp.draft && (
        <div className="bg-gray-800/60 border border-gray-700/60 rounded-xl p-4 mb-3">
          <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">{opp.draft}</p>
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-700/50">
            <span className={`text-xs ${charCountColor(opp.draft.length)}`}>
              {opp.draft.length}/280
            </span>
            <span className="text-xs text-gray-600 italic">Edit before posting</span>
          </div>
        </div>
      )}

      {/* Image search */}
      {opp.imageSearchQuery && (
        <a
          href={googleImagesUrl(opp.imageSearchQuery)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-400 transition-colors mb-3 group"
        >
          <span>🖼</span>
          <span className="group-hover:underline truncate">{opp.imageSearchQuery}</span>
          <span className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">↗</span>
        </a>
      )}

      {/* Hashtags */}
      {(opp.hashtagSuggestions?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {(opp.hashtagSuggestions ?? []).map(tag => (
            <span key={tag} className="text-xs px-2 py-0.5 bg-blue-500/10 text-blue-400/80 rounded-full">
              {tag.startsWith('#') ? tag : `#${tag}`}
            </span>
          ))}
        </div>
      )}

      {/* Reasoning */}
      {opp.reasoning && (
        <p className="text-xs text-gray-600 italic leading-relaxed mb-4">{opp.reasoning}</p>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={onCraft}
          className="flex-1 bg-white text-black py-2.5 rounded-xl font-semibold text-sm hover:bg-gray-100 transition"
        >
          ✏️ Craft & Copy
        </button>
        <button
          onClick={onPostNow}
          disabled={!opp.draft}
          title={opp.draft ? 'Post this draft directly to X' : 'No draft to post'}
          className="flex-1 bg-sky-500 text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-sky-400 disabled:bg-sky-900 disabled:text-sky-300 disabled:cursor-not-allowed transition"
        >
          🚀 Post Now
        </button>
        <button
          onClick={onPass}
          className="px-5 py-2.5 bg-gray-800 text-gray-400 rounded-xl text-sm hover:bg-gray-700 hover:text-white transition"
        >
          Pass
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DraftModal
// ---------------------------------------------------------------------------

function DraftModal({
  opp,
  draftText,
  onDraftChange,
  onAppendHashtag,
  onApprove,
  onClose,
}: {
  opp: Opportunity;
  draftText: string;
  onDraftChange: (v: string) => void;
  onAppendHashtag: (tag: string) => void;
  onApprove: () => void;
  onClose: () => void;
}) {
  const charCount = draftText.length;
  const overLimit = charCount > 280;

  return (
    <div
      className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl shadow-2xl">

        {/* Modal header */}
        <div className="px-7 pt-7 pb-5 border-b border-gray-800">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-white leading-tight">{opp.topic}</h2>
              {opp.contentAngle && (
                <p className="text-sm text-blue-400 mt-1">{opp.contentAngle}</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-gray-600 hover:text-white text-xl transition shrink-0 mt-0.5"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="px-7 py-6 space-y-5">

          {/* Tweet editor */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Draft Tweet
              </label>
              <span className={`text-xs font-medium tabular-nums ${charCountColor(charCount)}`}>
                {charCount}/280{overLimit && ' — over limit!'}
              </span>
            </div>
            <textarea
              value={draftText}
              onChange={e => onDraftChange(e.target.value)}
              rows={6}
              className={`w-full bg-gray-800 rounded-xl p-4 text-white text-sm leading-relaxed resize-y font-medium border transition-colors outline-none ${
                overLimit
                  ? 'border-red-500/60 focus:border-red-500'
                  : 'border-gray-700 focus:border-gray-500'
              }`}
              placeholder="Edit your tweet here…"
            />
          </div>

          {/* Hashtag chips — click to append */}
          {(opp.hashtagSuggestions?.length ?? 0) > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-2">Tap to add hashtag</p>
              <div className="flex flex-wrap gap-2">
                {(opp.hashtagSuggestions ?? []).map(tag => {
                  const display = tag.startsWith('#') ? tag : `#${tag}`;
                  return (
                    <button
                      key={tag}
                      onClick={() => onAppendHashtag(display)}
                      className="px-3 py-1 bg-blue-500/10 hover:bg-blue-500/25 text-blue-400 text-xs rounded-full transition-colors"
                    >
                      {display}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Image search */}
          {opp.imageSearchQuery && (
            <div className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-xl border border-gray-700/50">
              <span className="text-xl shrink-0">🖼</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-500 mb-0.5">Suggested image search</p>
                <p className="text-sm text-gray-300 truncate">{opp.imageSearchQuery}</p>
              </div>
              <a
                href={googleImagesUrl(opp.imageSearchQuery)}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded-lg transition"
              >
                Search ↗
              </a>
            </div>
          )}

          {/* Reasoning */}
          {opp.reasoning && (
            <div className="p-3 bg-gray-800/40 rounded-xl border border-gray-800">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Analysis</p>
              <p className="text-xs text-gray-400 leading-relaxed">{opp.reasoning}</p>
            </div>
          )}

        </div>

        {/* Footer actions */}
        <div className="px-7 pb-7 flex gap-3">
          <button
            onClick={onApprove}
            disabled={!draftText || overLimit}
            className="flex-1 bg-green-500 hover:bg-green-400 disabled:bg-green-900 disabled:opacity-50 disabled:cursor-not-allowed text-white py-3.5 rounded-xl font-semibold transition text-sm"
          >
            ✅ Copy to Clipboard
          </button>
          <button
            onClick={onClose}
            className="px-6 py-3.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl font-medium transition text-sm"
          >
            Cancel
          </button>
        </div>

      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PostConfirmModal — separate from DraftModal so the Craft & Copy flow is
// untouched. This modal exists ONLY for the Post Now button: review draft,
// optionally attach an image URL, confirm, post via /api/post-to-x.
// ---------------------------------------------------------------------------

function PostConfirmModal({
  opp,
  text,
  imageUrl,
  imageUrl2,
  videoUrl,
  inFlight,
  accounts,
  selectedAccounts,
  onToggleAccount,
  onTextChange,
  onImageUrlChange,
  onImageUrl2Change,
  onVideoUrlChange,
  onConfirm,
  onCancel,
}: {
  opp: Opportunity;
  text: string;
  imageUrl: string;
  imageUrl2: string;
  videoUrl: string;
  inFlight: boolean;
  accounts: AccountOption[];
  selectedAccounts: string[];
  onToggleAccount: (id: string) => void;
  onTextChange: (v: string) => void;
  onImageUrlChange: (v: string) => void;
  onImageUrl2Change: (v: string) => void;
  onVideoUrlChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const charCount = text.length;
  const overLimit = charCount > 280;
  const disabled = inFlight || overLimit || !text.trim() || selectedAccounts.length === 0;
  const isG07 = opp.galaxyId === 'galaxy.07';

  return (
    <div
      className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4"
      onClick={e => { if (e.target === e.currentTarget && !inFlight) onCancel(); }}
    >
      <div className="bg-gray-900 border border-sky-500/40 rounded-2xl w-full max-w-2xl shadow-2xl">

        <div className="px-7 pt-7 pb-5 border-b border-gray-800">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-white leading-tight">
                🚀 Post directly to X
              </h2>
              <p className="text-sm text-gray-400 mt-1">
                Review the draft, then confirm. This sends a real tweet from the selected account(s).
              </p>
            </div>
            <button
              onClick={onCancel}
              disabled={inFlight}
              className="text-gray-600 hover:text-white text-xl transition shrink-0 mt-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="px-7 py-6 space-y-5">

          {/* Account selector */}
          {accounts.length > 0 && (
            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-2">
                Post to {accounts.length > 1 && <span className="text-gray-600 normal-case font-normal">(select one or both)</span>}
              </label>
              <div className="flex flex-wrap gap-2">
                {accounts.map(acct => {
                  const on = selectedAccounts.includes(acct.id);
                  return (
                    <button
                      key={acct.id}
                      type="button"
                      onClick={() => onToggleAccount(acct.id)}
                      disabled={inFlight}
                      className={`cursor-pointer px-3 py-2 rounded-xl text-sm font-medium border transition-colors disabled:opacity-50 ${
                        on
                          ? 'bg-sky-500/15 border-sky-500 text-sky-300'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white hover:border-gray-600'
                      }`}
                    >
                      <span className="mr-1.5">{on ? '☑' : '☐'}</span>
                      {acct.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="px-3 py-2 bg-gray-800/40 rounded-lg border border-gray-800">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-0.5">Topic</p>
            <p className="text-sm text-gray-300 leading-snug">{opp.topic}</p>
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Tweet text
              </label>
              <span className={`text-xs font-medium tabular-nums ${
                overLimit ? 'text-red-400 font-semibold' : charCount > 260 ? 'text-yellow-400' : 'text-gray-500'
              }`}>
                {charCount}/280{overLimit && ' — over limit'}
              </span>
            </div>
            <textarea
              value={text}
              onChange={e => onTextChange(e.target.value)}
              disabled={inFlight}
              rows={6}
              className={`w-full bg-gray-800 rounded-xl p-4 text-white text-sm leading-relaxed resize-y font-medium border transition-colors outline-none disabled:opacity-60 disabled:cursor-not-allowed ${
                overLimit ? 'border-red-500/60 focus:border-red-500' : 'border-gray-700 focus:border-sky-500'
              }`}
              placeholder="Edit before posting…"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-2">
              Image 1 {isG07 && <span className="text-sky-500/80">(G07)</span>}
              <span className="text-gray-600 normal-case font-normal"> — optional, public http(s)</span>
            </label>
            <input
              type="url"
              value={imageUrl}
              onChange={e => onImageUrlChange(e.target.value)}
              disabled={inFlight}
              placeholder="https://example.com/photo1.jpg"
              className="w-full bg-gray-800 rounded-xl px-4 py-3 text-white text-sm border border-gray-700 focus:border-sky-500 outline-none transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            />
          </div>

          {isG07 && (
            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-2">
                Image 2 <span className="text-gray-600 normal-case font-normal">— must differ from image 1</span>
              </label>
              <input
                type="url"
                value={imageUrl2}
                onChange={e => onImageUrl2Change(e.target.value)}
                disabled={inFlight}
                placeholder="https://example.com/photo2.jpg"
                className="w-full bg-gray-800 rounded-xl px-4 py-3 text-white text-sm border border-gray-700 focus:border-sky-500 outline-none transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              />
            </div>
          )}

          {isG07 && (
            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-2">
                Video URL <span className="text-gray-600 normal-case font-normal">— direct .mp4 (Reddit clips)</span>
              </label>
              <input
                type="url"
                value={videoUrl}
                onChange={e => onVideoUrlChange(e.target.value)}
                disabled={inFlight}
                placeholder="https://v.redd.it/....mp4"
                className="w-full bg-gray-800 rounded-xl px-4 py-3 text-white text-sm border border-gray-700 focus:border-sky-500 outline-none transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              />
              <p className="text-xs text-gray-600 mt-1.5">
                X allows <strong className="text-gray-500">one video OR up to 2 images</strong> per tweet — not both.
                If a video URL is set, images are skipped on post. YouTube uses 2 thumbnails as images instead.
              </p>
            </div>
          )}

          {!isG07 && (
            <p className="text-xs text-gray-600 -mt-2">
              {imageUrl
                ? <>Pre-filled from source. Clear to post text-only.</>
                : <>Max 5MB. Suggested search: <span className="text-gray-500">{opp.imageSearchQuery || '—'}</span></>}
            </p>
          )}

          <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-xs text-yellow-200 leading-relaxed">
            ⚠️ This will post a <strong>real tweet</strong> to your X account immediately. There is no undo from the dashboard — only manual deletion from X itself.
          </div>

        </div>

        <div className="px-7 pb-7 flex gap-3">
          <button
            onClick={onConfirm}
            disabled={disabled}
            className="flex-1 bg-sky-500 hover:bg-sky-400 disabled:bg-sky-900 disabled:opacity-50 disabled:cursor-not-allowed text-white py-3.5 rounded-xl font-semibold transition text-sm"
          >
            {inFlight ? 'Posting…' : '🚀 Confirm — Post to X'}
          </button>
          <button
            onClick={onCancel}
            disabled={inFlight}
            className="px-6 py-3.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl font-medium transition text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
        </div>

      </div>
    </div>
  );
}
