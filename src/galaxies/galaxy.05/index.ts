// src/galaxies/galaxy.05/index.ts
//
// Galaxy.05 facade — orchestrates sub-variants (05.01, 05.02, …).
// Brain stays at galaxy.05; pick variant via GALAXY_05_VARIANT or opts.variant.

import Anthropic from '@anthropic-ai/sdk';
import { UserPreferences, OpportunitySignals } from '@/shared/types';
import {
  pushOpportunity,
  removeOpportunity,
  readOpportunities,
  StoredOpportunity,
} from '@/store/opportunity-store';
import {
  maybeAutoPostOncePerCycle,
  resetAutoPostCycle,
  isAutoPostEnabled,
  X_POST_ESTIMATE_USD,
} from '@/lib/auto-poster';
import { resolveGalaxy05Variant, DEFAULT_GALAXY_05_VARIANT } from './registry';
import {
  TESTING_MODE,
  MIN_SCORE_TESTING,
  HAIKU_INPUT_USD_PER_M,
  HAIKU_OUTPUT_USD_PER_M,
  MAX_ANALYZE_DEFAULT,
  MAX_TRENDS_FETCH,
} from './shared/constants';
import { X_TRENDS_ESTIMATE_USD } from './shared/trends';
import type { HybridAnalysisOptions, PollOptions } from './types';

export type { HybridAnalysisOptions, PollOptions, Galaxy05VariantId } from './types';
export { listGalaxy05Variants, DEFAULT_GALAXY_05_VARIANT } from './registry';

let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!_anthropic) {
    const apiKey = process.env.VP_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('No Anthropic API key. Set VP_ANTHROPIC_KEY in .env.local');
    _anthropic = new Anthropic({ apiKey });
  }
  return _anthropic;
}

export class Galaxy05 {
  static id = 'galaxy.05';
  static label = 'Galaxy.05 - X Early Mover (variants)';

  private pollCount = 0;
  private pollTimer: NodeJS.Timeout | null = null;

  async processOpportunity(signals: OpportunitySignals, userPrefs: UserPreferences): Promise<any> {
    const variant = resolveGalaxy05Variant();
    const { result } = await this._processWithUsage(
      signals,
      userPrefs,
      variant.systemPrompt,
      variant.buildUserMessage(signals, userPrefs),
    );
    return result;
  }

  async runHybridAnalysis(opts: HybridAnalysisOptions): Promise<StoredOpportunity[]> {
    const {
      userPrefs,
      variant: variantId,
      woeid = 1,
      maxTrends = MAX_TRENDS_FETCH,
      maxAnalyze = MAX_ANALYZE_DEFAULT,
      filterNoise = true,
      pushToStore = true,
      autoPost = true,
    } = opts;

    const variant = resolveGalaxy05Variant(variantId);
    resetAutoPostCycle();

    const ts = new Date().toLocaleTimeString();
    console.log(`\n─────────────────────────────────────────`);
    console.log(`⚡  Galaxy.05   variant ${variant.id} — ${variant.label}`);
    console.log(`    ${ts}${TESTING_MODE ? '  [TESTING MODE]' : ''}`);
    console.log(`    ${variant.description}`);
    console.log(
      `    woeid=${woeid}  maxAnalyze=${maxAnalyze}  autoPost=${autoPost && isAutoPostEnabled()}`,
    );
    console.log(`─────────────────────────────────────────`);

    const existing = await readOpportunities();
    if (existing.length > 0) {
      console.log(`🔄  Skipping topics similar to ${existing.length} item(s) in store`);
    }

    const { candidates } = await variant.collectCandidates({
      userPrefs,
      woeid,
      maxTrends,
      maxAnalyze,
      filterNoise,
      existing,
    });

    if (candidates.length === 0) {
      console.log('📭  No candidates this cycle.');
      return [];
    }

    console.log(`📊  Analyzing ${candidates.length} candidate(s):`);
    for (const c of candidates) {
      console.log(`    • ${c.logLabel}`);
    }

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const results: StoredOpportunity[] = [];

    for (const candidate of candidates) {
      try {
        const userMessage = variant.buildUserMessage(candidate.signals, userPrefs);
        const { result, inputTokens, outputTokens } = await this._processWithUsage(
          candidate.signals,
          userPrefs,
          variant.systemPrompt,
          userMessage,
        );
        totalInputTokens += inputTokens;
        totalOutputTokens += outputTokens;

        const score = (result.viralityScore as number) ?? 0;
        const conf = (result.confidence as number) ?? 0;
        const shouldAct = !!result.shouldAct;
        const scoreStr = `score:${score} conf:${conf}% shouldAct:${shouldAct}`;
        const shouldPush = TESTING_MODE ? score >= MIN_SCORE_TESTING : shouldAct;

        if (!shouldPush) {
          console.log(`⏭️   ${candidate.topic.slice(0, 60)} — ${scoreStr}`);
          continue;
        }

        console.log(`${shouldAct ? '🔥' : '🧪'}  ${candidate.topic.slice(0, 60)} — ${scoreStr}`);

        const opp: StoredOpportunity = {
          id: `g5_${variant.id.replace('.', '_')}_${Date.now()}_${candidate.idSlug}`,
          topic: candidate.topic,
          viralityScore: score,
          confidence: conf,
          draft: (result.draftTweet as string) ?? '',
          contentAngle: (result.contentAngle as string) ?? '',
          imageSearchQuery: (result.imageSearchQuery as string) ?? '',
          imageUrl: candidate.imageUrl,
          reasoning: (result.reasoning as string) ?? '',
          shouldAct,
          roiEstimate: (result.roiEstimate as 'high' | 'medium' | 'low') ?? 'medium',
          hashtagSuggestions: (result.hashtagSuggestions as string[]) ?? [],
          optimalPostTime: (result.optimalPostTime as string) ?? 'now',
          source: 'detector',
          detectedAt: new Date().toISOString(),
          galaxyId: 'galaxy.05',
          galaxyVariant: variant.id,
        };

        results.push(opp);
        if (pushToStore) await pushOpportunity(opp);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`❌  Analysis failed for "${candidate.topic.slice(0, 50)}": ${msg}`);
      }
    }

    if (autoPost && results.length > 0) {
      const autoCandidate = results
        .filter((o) => o.shouldAct)
        .sort((a, b) => b.viralityScore - a.viralityScore)[0];

      if (autoCandidate) {
        const postResult = await maybeAutoPostOncePerCycle(autoCandidate);
        if (postResult.posted) {
          console.log(`📤  Removed from dashboard queue (already live on X)`);
          if (pushToStore) await removeOpportunity(autoCandidate.id);
        } else if (isAutoPostEnabled()) {
          console.log(`📤  Auto-post skipped: ${postResult.reason}`);
        }
      } else {
        console.log(`📤  Auto-post skipped: no shouldAct opportunities this cycle`);
      }
    }

    const claudeCost =
      (totalInputTokens / 1_000_000) * HAIKU_INPUT_USD_PER_M +
      (totalOutputTokens / 1_000_000) * HAIKU_OUTPUT_USD_PER_M;
    const totalCost = claudeCost + X_TRENDS_ESTIMATE_USD;

    console.log(`\n💰  Cycle cost (variant ${variant.id}): $${totalCost.toFixed(4)}`);
    console.log(`    Claude: $${claudeCost.toFixed(4)}  (${totalInputTokens} in + ${totalOutputTokens} out)`);
    console.log(`    X Trends: $${X_TRENDS_ESTIMATE_USD.toFixed(4)}`);
    if (isAutoPostEnabled()) {
      console.log(`    Auto-post est.: +$${X_POST_ESTIMATE_USD.toFixed(3)}/post when shouldAct fires`);
    }
    console.log(`✅  ${results.length} opportunit${results.length === 1 ? 'y' : 'ies'} pushed.\n`);

    return results;
  }

  async start(opts: PollOptions): Promise<void> {
    const { intervalMinutes = 60, autoPost = true, variant, ...analysisOpts } = opts;
    const active = resolveGalaxy05Variant(variant);

    if (intervalMinutes < 30) {
      console.warn(`⚠️  intervalMinutes=${intervalMinutes} is aggressive for pay-per-use X.`);
    }

    console.log(`\n🚀  Galaxy.05 detector starting — variant ${active.id} (${active.label})`);
    console.log(`⏱   Polling every ${intervalMinutes} minutes`);
    console.log(`📤  Auto-post: ${autoPost && isAutoPostEnabled() ? 'ENABLED' : 'disabled'}\n`);

    const tick = async () => {
      this.pollCount++;
      try {
        await this.runHybridAnalysis({ ...analysisOpts, variant, autoPost, pushToStore: true });
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
      console.log(`\n🛑  Galaxy.05 detector stopped after ${this.pollCount} cycles.`);
    }
  }

  private async _processWithUsage(
    _signals: OpportunitySignals,
    _userPrefs: UserPreferences,
    systemPrompt: string,
    userMessage: string,
  ): Promise<{ result: Record<string, unknown>; inputTokens: number; outputTokens: number }> {
    const response = await getAnthropic().messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      temperature: TESTING_MODE ? 0.5 : 0.7,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
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
  return { error: 'Failed to parse Galaxy.05 response', raw };
}
