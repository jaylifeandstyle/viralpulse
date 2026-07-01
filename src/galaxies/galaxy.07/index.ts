// src/galaxies/galaxy.07/index.ts
//
// Galaxy.07 — Cross-platform Pure Growth fusion.
// Reddit + Hacker News + optional YouTube + optional X Trends → fuse → Haiku.

import Anthropic from '@anthropic-ai/sdk';
import { UserPreferences, OpportunitySignals } from '@/shared/types';
import {
  pushOpportunity,
  readOpportunities,
  StoredOpportunity,
} from '@/store/opportunity-store';
import { X_TRENDS_ESTIMATE_USD } from '@/galaxies/galaxy.05/shared/trends';
import { GALAXY_07_PURE_GROWTH_PROMPT } from './prompts';
import { fetchRedditCandidates } from './adapters/reddit';
import { fetchHackerNewsCandidates } from './adapters/hackernews';
import { fetchYouTubeCandidates } from './adapters/youtube';
import { fetchXTrendCandidates } from './adapters/x-trends';
import { fuseCandidates, rankFusedClusters, clusterToSignals } from './fusion';
import { applyMediaToCluster } from './shared/media';
import { enrichClusterMedia, hasPostableMedia } from './shared/enrich-media';
import { isTopicAlreadyCovered } from './shared/dedupe';
import { slugify } from './shared/keywords';
import type { AnalysisCandidate, FusionAnalysisOptions, PollOptions } from './types';

export type { FusionAnalysisOptions, PollOptions } from './types';

const TESTING_MODE = true;
const MIN_SCORE_TESTING = 35;
const MAX_ANALYZE_DEFAULT = 4;

const HAIKU_INPUT_USD_PER_M = 1.0;
const HAIKU_OUTPUT_USD_PER_M = 5.0;

let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!_anthropic) {
    const apiKey = process.env.VP_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('No Anthropic API key. Set VP_ANTHROPIC_KEY in .env.local');
    _anthropic = new Anthropic({ apiKey });
  }
  return _anthropic;
}

export class Galaxy07 {
  static id = 'galaxy.07';
  static label = 'Galaxy.07 - Cross-Platform Pure Growth';

  private pollCount = 0;
  private pollTimer: NodeJS.Timeout | null = null;

  async processOpportunity(signals: OpportunitySignals, userPrefs: UserPreferences): Promise<any> {
    const { result } = await this._processWithUsage(signals, userPrefs);
    return result;
  }

  async runFusionAnalysis(opts: FusionAnalysisOptions): Promise<StoredOpportunity[]> {
    const {
      userPrefs,
      maxAnalyze = MAX_ANALYZE_DEFAULT,
      includeXTrends = true,
      pushToStore = true,
    } = opts;

    const ts = new Date().toLocaleTimeString();
    console.log(`\n─────────────────────────────────────────`);
    console.log(`🌐  Galaxy.07 cross-platform fusion   ${ts}${TESTING_MODE ? '  [TESTING MODE]' : ''}`);
    console.log(`    mode=pure_growth  maxAnalyze=${maxAnalyze}`);
    console.log(`─────────────────────────────────────────`);

    const existing = await readOpportunities();

    console.log(`📡  Fetching adapters in parallel…`);
    const useX = includeXTrends && !!process.env.X_BEARER_TOKEN;
    const [reddit, hn, youtube, xTrends] = await Promise.all([
      fetchRedditCandidates(),
      fetchHackerNewsCandidates(),
      fetchYouTubeCandidates(),
      useX ? fetchXTrendCandidates() : Promise.resolve([]),
    ]);

    console.log(`    Reddit: ${reddit.length}  HN: ${hn.length}  YouTube: ${youtube.length}  X: ${xTrends.length}`);

    const raw = [...reddit, ...hn, ...youtube, ...xTrends].filter(
      (c) => !isTopicAlreadyCovered(c.title, existing),
    );

    if (raw.length === 0) {
      console.log('📭  No fresh cross-platform candidates.');
      return [];
    }

    const fused = rankFusedClusters(fuseCandidates(raw).map(applyMediaToCluster));
    const enrichPool = fused.slice(0, Math.min(fused.length, maxAnalyze * 3));

    console.log(`🔀  Fused ${raw.length} items → ${fused.length} clusters → enriching top ${enrichPool.length}…`);
    const enriched = await Promise.all(
      enrichPool.map(async (cluster) =>
        hasPostableMedia(cluster) ? cluster : enrichClusterMedia(cluster),
      ),
    );
    const remainder = fused.slice(enrichPool.length);
    const top = rankFusedClusters([...enriched, ...remainder]).slice(0, maxAnalyze);

    console.log(`📸  Analyzing ${top.length} (media-rich first):`);
    for (const c of top) {
      const plat = c.platforms.join('+');
      const mediaHint = c.videoUrl
        ? `video+${c.imageUrls?.length ?? 0}img`
        : `${c.imageUrls?.length ?? 0}img`;
      console.log(
        `    • [${plat}] ${mediaHint} fit:${c.predictedXFit} — ${c.primaryTitle.slice(0, 50)}`,
      );
    }

    const candidates: AnalysisCandidate[] = top.map((cluster) => ({
      topic: cluster.primaryTitle,
      signals: clusterToSignals(cluster),
      idSlug: slugify(cluster.primaryTitle),
      logLabel: `[${cluster.platforms.join('+')}] ${cluster.primaryTitle.slice(0, 60)}`,
      fusion: cluster,
    }));

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const results: StoredOpportunity[] = [];

    for (const candidate of candidates) {
      try {
        const { result, inputTokens, outputTokens } = await this._processWithUsage(
          candidate.signals,
          userPrefs,
        );
        totalInputTokens += inputTokens;
        totalOutputTokens += outputTokens;

        const score = (result.viralityScore as number) ?? 0;
        const conf = (result.confidence as number) ?? 0;
        const shouldAct = !!result.shouldAct;
        const scoreStr = `score:${score} conf:${conf}% shouldAct:${shouldAct}`;
        const shouldPush = TESTING_MODE ? score >= MIN_SCORE_TESTING : shouldAct;

        if (!shouldPush) {
          console.log(`⏭️   ${candidate.logLabel} — ${scoreStr}`);
          continue;
        }

        let fusion = candidate.fusion;
        if (!hasPostableMedia(fusion)) {
          fusion = await enrichClusterMedia(fusion);
        }
        if (!hasPostableMedia(fusion)) {
          console.log(`⏭️   ${candidate.logLabel} — no postable media, skipping push`);
          continue;
        }

        console.log(`${shouldAct ? '🔥' : '🧪'}  ${candidate.logLabel} — ${scoreStr}`);

        const opp: StoredOpportunity = {
          id: `g7_${Date.now()}_${candidate.idSlug}`,
          topic: candidate.topic,
          viralityScore: score,
          confidence: conf,
          draft: (result.draftTweet as string) ?? '',
          contentAngle: (result.contentAngle as string) ?? '',
          imageSearchQuery: (result.imageSearchQuery as string) ?? '',
          imageUrl: fusion.imageUrls?.[0],
          imageUrls: fusion.imageUrls,
          videoUrl: fusion.videoUrl,
          reasoning: (result.reasoning as string) ?? '',
          shouldAct,
          roiEstimate: (result.roiEstimate as 'high' | 'medium' | 'low') ?? 'medium',
          hashtagSuggestions: (result.hashtagSuggestions as string[]) ?? [],
          optimalPostTime: (result.optimalPostTime as string) ?? 'now',
          source: 'detector',
          detectedAt: new Date().toISOString(),
          galaxyId: 'galaxy.07',
          galaxyVariant: '07.01',
        };

        results.push(opp);
        if (pushToStore) await pushOpportunity(opp);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`❌  Analysis failed: ${msg}`);
      }
    }

    const claudeCost =
      (totalInputTokens / 1_000_000) * HAIKU_INPUT_USD_PER_M +
      (totalOutputTokens / 1_000_000) * HAIKU_OUTPUT_USD_PER_M;
    const xCost = useX ? X_TRENDS_ESTIMATE_USD : 0;
    const totalCost = claudeCost + xCost;

    console.log(`\n💰  Cycle cost: $${totalCost.toFixed(4)}`);
    console.log(`    Claude: $${claudeCost.toFixed(4)}  (${totalInputTokens} in + ${totalOutputTokens} out)`);
    if (useX) console.log(`    X Trends: $${xCost.toFixed(4)}`);
    console.log(`✅  ${results.length} opportunit${results.length === 1 ? 'y' : 'ies'} pushed.\n`);

    return results;
  }

  async start(opts: PollOptions): Promise<void> {
    const { intervalMinutes = 60, ...analysisOpts } = opts;

    console.log(`\n🚀  Galaxy.07 fusion detector starting`);
    console.log(`⏱   Polling every ${intervalMinutes} minutes`);
    console.log(`📤  Manual Post Now only — auto-post disabled for G07\n`);

    const tick = async () => {
      this.pollCount++;
      try {
        await this.runFusionAnalysis({ ...analysisOpts, pushToStore: true });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`💥  Cycle #${this.pollCount} failed: ${msg}`);
      }
    };

    await tick();
    this.pollTimer = setInterval(tick, intervalMinutes * 60 * 1000);
    process.stdin.resume();
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      console.log(`\n🛑  Galaxy.07 stopped after ${this.pollCount} cycles.`);
    }
  }

  private async _processWithUsage(
    signals: OpportunitySignals,
    userPrefs: UserPreferences,
  ): Promise<{ result: Record<string, unknown>; inputTokens: number; outputTokens: number }> {
    const response = await getAnthropic().messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      temperature: TESTING_MODE ? 0.65 : 0.75,
      system: GALAXY_07_PURE_GROWTH_PROMPT,
      messages: [
        {
          role: 'user',
          content:
            `User Preferences:\n${JSON.stringify({ ...userPrefs, mode: 'pure_growth' }, null, 2)}\n\n` +
            `Fused Cross-Platform Signal:\n${JSON.stringify(signals, null, 2)}\n\n` +
            `Write a Pure Growth tweet — hook-first, engagement-optimized. NO URLs in draft.`,
        },
      ],
    });

    const block = response.content[0];
    const raw = block.type === 'text' ? block.text : '{}';
    return {
      result: extractJson(raw),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
}

function extractJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {}
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {}
  }
  return { error: 'Failed to parse Galaxy.07 response', raw };
}
