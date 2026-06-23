// src/galaxies/galaxy.05/index.ts
//
// Galaxy.05 — X Trends-first early mover (+ optional Google News anchor).
//
// Deliberately NOT Galaxy.04:
//   G04 = BBC RSS category sweep → straight news takes
//   G05 = X Trends → enrich only those topics → discourse angles + auto-post
//
// Budget-safe: 1 trends call (~$0.01) + ≤4 Haiku + free Google News RSS per trend.
// Skips topics already in the opportunity store (fuzzy match vs G04/G05).

import Anthropic from '@anthropic-ai/sdk';
import { TwitterApi } from 'twitter-api-v2';
import { GALAXY_05_SYSTEM_PROMPT } from './prompts';
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

const TESTING_MODE = true;
const MIN_SCORE_TESTING = 35;

const HAIKU_INPUT_USD_PER_M = 1.0;
const HAIKU_OUTPUT_USD_PER_M = 5.0;
const X_TRENDS_ESTIMATE_USD = 0.01;

const MAX_ANALYZE_DEFAULT = 4;
const MAX_TRENDS_FETCH = 15;
const NEWS_FETCH_TIMEOUT_MS = 5000;

type Trend = { name: string; tweet_volume: number };

type NewsContextItem = {
  source: 'google-news';
  title: string;
  description: string;
  pubDate: string;
};

type TrendCandidate = Trend & {
  newsContext: NewsContextItem[];
  hasNewsAnchor: boolean;
};

type V2TrendItem = { trend_name: string; tweet_count?: number };
type V2TrendsResponse = {
  data?: V2TrendItem[];
  errors?: Array<{ type?: string; title?: string; detail?: string; status?: number }>;
};

let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!_anthropic) {
    const apiKey = process.env.VP_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('No Anthropic API key. Set VP_ANTHROPIC_KEY in .env.local');
    _anthropic = new Anthropic({ apiKey });
  }
  return _anthropic;
}

let _twitter: TwitterApi | null = null;
function getTwitter(): TwitterApi {
  if (!_twitter) {
    const token = process.env.X_BEARER_TOKEN;
    if (!token) throw new Error('X_BEARER_TOKEN is not set — Galaxy.05 is trends-first and needs it.');
    _twitter = new TwitterApi(token.trim());
  }
  return _twitter;
}

export type HybridAnalysisOptions = {
  userPrefs: UserPreferences;
  woeid?: number;
  maxTrends?: number;
  maxAnalyze?: number;
  filterNoise?: boolean;
  pushToStore?: boolean;
  autoPost?: boolean;
};

export type PollOptions = Omit<HybridAnalysisOptions, 'pushToStore' | 'autoPost'> & {
  intervalMinutes?: number;
  autoPost?: boolean;
};

export class Galaxy05 {
  static id = 'galaxy.05';
  static label = 'Galaxy.05 - X Trends Early Mover';

  private pollCount = 0;
  private pollTimer: NodeJS.Timeout | null = null;

  async processOpportunity(signals: OpportunitySignals, userPrefs: UserPreferences): Promise<any> {
    const { result } = await this._processWithUsage(signals, userPrefs);
    return result;
  }

  async runHybridAnalysis(opts: HybridAnalysisOptions): Promise<StoredOpportunity[]> {
    const {
      userPrefs,
      woeid = 1,
      maxTrends = MAX_TRENDS_FETCH,
      maxAnalyze = MAX_ANALYZE_DEFAULT,
      filterNoise = true,
      pushToStore = true,
      autoPost = true,
    } = opts;

    resetAutoPostCycle();

    const ts = new Date().toLocaleTimeString();
    console.log(`\n─────────────────────────────────────────`);
    console.log(`⚡  Galaxy.05 X-trends pull   ${ts}${TESTING_MODE ? '  [TESTING MODE]' : ''}`);
    console.log(
      `    woeid=${woeid}  maxAnalyze=${maxAnalyze}  autoPost=${autoPost && isAutoPostEnabled()}`,
    );
    console.log(`    (Galaxy.04 owns BBC news — G05 only analyzes rising X topics)`);
    console.log(`─────────────────────────────────────────`);

    const existing = await readOpportunities();
    if (existing.length > 0) {
      console.log(`🔄  Skipping topics similar to ${existing.length} item(s) already in store`);
    }

    // 1. X Trends (required — this IS the product)
    const rawTrends = await fetchTrendsV2(woeid, maxTrends);
    console.log(`📈  X Trends: ${rawTrends.length} topic(s) (~$${X_TRENDS_ESTIMATE_USD.toFixed(2)})`);

    let trends = rawTrends;
    if (filterNoise) {
      trends = trends.filter((t) => !isLikelyNoise(t.name));
      console.log(`    ${trends.length} after noise filter (${rawTrends.length - trends.length} skipped)`);
    }

    // Skip trends already covered by G04/G05 in the store
    const freshTrends = trends.filter((t) => !isTopicAlreadyCovered(t.name, existing));
    const skippedDupes = trends.length - freshTrends.length;
    if (skippedDupes > 0) {
      console.log(`    ↷ ${skippedDupes} trend(s) skipped — already in dashboard/store`);
    }

    if (freshTrends.length === 0) {
      console.log('📭  No new X trends to analyze (all duplicates or noise).');
      return [];
    }

    // 2. Google News context per trend (parallel, free) — anchor facts, not primary source
    console.log(`📰  Fetching news anchor for up to ${maxAnalyze} trend(s)…`);
    const enriched: TrendCandidate[] = [];
    for (const trend of freshTrends.slice(0, maxAnalyze + 2)) {
      const newsContext = await fetchNewsContext(trend.name, 3);
      if (newsContext.some((n) => isTopicAlreadyCovered(n.title, existing))) {
        console.log(`    ↷ ${trend.name} — news headline already covered`);
        continue;
      }
      enriched.push({
        ...trend,
        newsContext,
        hasNewsAnchor: newsContext.length > 0,
      });
      if (enriched.length >= maxAnalyze) break;
    }

    if (enriched.length === 0) {
      console.log('📭  All candidate trends overlap existing store topics.');
      return [];
    }

    console.log(`📊  Analyzing ${enriched.length} X trend(s):`);
    for (const c of enriched) {
      const vol = c.tweet_volume?.toLocaleString() ?? '?';
      const anchor = c.hasNewsAnchor ? `${c.newsContext.length} news` : 'trend-only';
      console.log(`    • ${c.name}  (${vol} posts, ${anchor})`);
    }

    // 3. Haiku — discourse angles, not headline regurgitation
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const results: StoredOpportunity[] = [];

    for (const candidate of enriched) {
      const signals = trendToSignal(candidate);
      try {
        const { result, inputTokens, outputTokens } = await this._processWithUsage(signals, userPrefs);
        totalInputTokens += inputTokens;
        totalOutputTokens += outputTokens;

        const score = (result.viralityScore as number) ?? 0;
        const conf = (result.confidence as number) ?? 0;
        const shouldAct = !!result.shouldAct;
        const scoreStr = `score:${score} conf:${conf}% shouldAct:${shouldAct}`;
        const shouldPush = TESTING_MODE ? score >= MIN_SCORE_TESTING : shouldAct;

        if (!shouldPush) {
          console.log(`⏭️   ${candidate.name} — ${scoreStr}`);
          continue;
        }

        console.log(`${shouldAct ? '🔥' : '🧪'}  ${candidate.name} — ${scoreStr}`);

        const opp: StoredOpportunity = {
          id: `g5_${Date.now()}_${candidate.name.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 32)}`,
          topic: candidate.name,
          viralityScore: score,
          confidence: conf,
          draft: (result.draftTweet as string) ?? '',
          contentAngle: (result.contentAngle as string) ?? '',
          imageSearchQuery: (result.imageSearchQuery as string) ?? '',
          reasoning: (result.reasoning as string) ?? '',
          shouldAct,
          roiEstimate: (result.roiEstimate as 'high' | 'medium' | 'low') ?? 'medium',
          hashtagSuggestions: (result.hashtagSuggestions as string[]) ?? [],
          optimalPostTime: (result.optimalPostTime as string) ?? 'now',
          source: 'detector',
          detectedAt: new Date().toISOString(),
        };

        results.push(opp);
        if (pushToStore) await pushOpportunity(opp);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`❌  Analysis failed for "${candidate.name}": ${msg}`);
      }
    }

    // 4. Auto-post best shouldAct (once per cycle)
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

    const inputCost = (totalInputTokens / 1_000_000) * HAIKU_INPUT_USD_PER_M;
    const outputCost = (totalOutputTokens / 1_000_000) * HAIKU_OUTPUT_USD_PER_M;
    const claudeCost = inputCost + outputCost;
    const totalCost = claudeCost + X_TRENDS_ESTIMATE_USD;

    console.log(`\n💰  Cycle cost: $${totalCost.toFixed(4)}`);
    console.log(`    Claude: $${claudeCost.toFixed(4)}  (${totalInputTokens} in + ${totalOutputTokens} out)`);
    console.log(`    X Trends: $${X_TRENDS_ESTIMATE_USD.toFixed(4)}`);
    console.log(
      `    Projected: $${(totalCost * 24).toFixed(2)}/day hourly, $${(totalCost * 24 * 30).toFixed(2)}/month`,
    );
    if (isAutoPostEnabled()) {
      console.log(`    Auto-post est.: +$${X_POST_ESTIMATE_USD.toFixed(3)}/post when shouldAct fires`);
    }
    console.log(`✅  ${results.length} opportunit${results.length === 1 ? 'y' : 'ies'} pushed.\n`);

    return results;
  }

  async start(opts: PollOptions): Promise<void> {
    const { intervalMinutes = 60, autoPost = true, ...analysisOpts } = opts;

    if (intervalMinutes < 30) {
      console.warn(`⚠️  intervalMinutes=${intervalMinutes} is aggressive for pay-per-use X.`);
    }

    console.log(`\n🚀  Galaxy.05 X-trends detector starting`);
    console.log(`⏱   Polling every ${intervalMinutes} minutes`);
    console.log(`📤  Auto-post: ${autoPost && isAutoPostEnabled() ? 'ENABLED' : 'disabled'}\n`);

    const tick = async () => {
      this.pollCount++;
      try {
        await this.runHybridAnalysis({ ...analysisOpts, autoPost, pushToStore: true });
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
    signals: OpportunitySignals,
    userPrefs: UserPreferences,
  ): Promise<{ result: Record<string, unknown>; inputTokens: number; outputTokens: number }> {
    const response = await getAnthropic().messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      temperature: TESTING_MODE ? 0.5 : 0.7,
      system: GALAXY_05_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content:
            `User Preferences:\n${JSON.stringify(userPrefs, null, 2)}\n\n` +
            `X Trend Signal:\n${JSON.stringify(signals, null, 2)}\n\n` +
            `Write a discourse-angle tweet — do NOT recap the headline. Never write monitor language.`,
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

// ─────────────────────────────────────────────────────────────────────────────
// Cross-galaxy dedupe — fuzzy match vs store (G04 headlines + G05 trends)
// ─────────────────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'have', 'been', 'will',
  'says', 'after', 'over', 'into', 'about', 'their', 'what', 'when', 'where',
  'who', 'how', 'new', 'news', 'trending',
]);

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/^#/, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
}

function topicsSimilar(a: string, b: string): boolean {
  const ka = extractKeywords(a);
  const kb = extractKeywords(b);
  if (ka.length === 0 || kb.length === 0) return false;
  const overlap = ka.filter((k) => kb.some((bk) => bk.includes(k) || k.includes(bk)));
  const minLen = Math.min(ka.length, kb.length);
  return overlap.length >= Math.max(2, Math.ceil(minLen * 0.5));
}

function isTopicAlreadyCovered(topic: string, existing: StoredOpportunity[]): boolean {
  return existing.some((o) => topicsSimilar(topic, o.topic));
}

// ─────────────────────────────────────────────────────────────────────────────
// Google News RSS per trend (same as Galaxy.03 — free factual anchor)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchNewsContext(topic: string, maxItems = 3): Promise<NewsContextItem[]> {
  const cleaned = topic.replace(/^#/, '').trim();
  if (!cleaned) return [];
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(cleaned)}&hl=en-US&gl=US&ceid=US:en`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ViralPulse/1.0)',
        Accept: 'application/rss+xml,application/xml,text/xml',
      },
      signal: AbortSignal.timeout(NEWS_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    return parseGoogleRss(await res.text(), maxItems);
  } catch {
    return [];
  }
}

function parseGoogleRss(xml: string, maxItems: number): NewsContextItem[] {
  const items: NewsContextItem[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;
  while ((match = itemRe.exec(xml)) !== null && items.length < maxItems) {
    const block = match[1];
    const title = extractTag(block, 'title');
    if (!title) continue;
    items.push({
      source: 'google-news',
      title: decodeHtml(title).slice(0, 200),
      description: decodeHtml(extractTag(block, 'description') ?? '').slice(0, 240),
      pubDate: (extractTag(block, 'pubDate') ?? '').slice(0, 32),
    });
  }
  return items;
}

function trendToSignal(candidate: TrendCandidate): OpportunitySignals {
  return {
    topic: candidate.name,
    velocity: Math.round((candidate.tweet_volume ?? 100) / 60),
    acceleration: 1,
    avgEngagement: candidate.tweet_volume ?? 0,
    trending: true,
    samplePosts: candidate.newsContext,
    timestamp: new Date(),
    // @ts-expect-error — metadata for prompt
    metadata: {
      tweetVolume: candidate.tweet_volume,
      hasNewsAnchor: candidate.hasNewsAnchor,
      galaxy: '05',
    },
  };
}

function isLikelyNoise(name: string): boolean {
  const lower = name.toLowerCase();
  const noisePatterns = [
    /^#?[a-z]+(loves|forever|stan|nation|army|fam|hive)\d*$/i,
    /^#?happy.*day$/i,
    /^#?(rt|like|follow)\b/i,
    /^#?good(morning|night|evening)\b/i,
    /^#?team[a-z]+$/i,
  ];
  return noisePatterns.some((re) => re.test(lower));
}

// ─────────────────────────────────────────────────────────────────────────────
// X v2 Trends
// ─────────────────────────────────────────────────────────────────────────────

async function fetchTrendsV2(woeid: number, maxTrends: number): Promise<Trend[]> {
  const response = await getTwitter().v2.get<V2TrendsResponse>(`trends/by/woeid/${woeid}`, {
    max_trends: maxTrends,
    'trend.fields': 'trend_name,tweet_count',
  });

  if ((!response.data || response.data.length === 0) && response.errors?.length) {
    const e = response.errors[0];
    throw new Error(`X v2 trends errors: ${e.detail ?? e.title ?? 'unknown'}`);
  }

  return (response.data ?? []).map((t) => ({
    name: t.trend_name,
    tweet_volume: t.tweet_count ?? 0,
  }));
}

function extractTag(xml: string, tag: string): string | null {
  const cdataRe = new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`);
  const cdataMatch = xml.match(cdataRe);
  if (cdataMatch) return cdataMatch[1];
  const normalRe = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
  const normalMatch = xml.match(normalRe);
  return normalMatch ? normalMatch[1] : null;
}

function decodeHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
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
