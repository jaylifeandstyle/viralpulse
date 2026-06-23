// src/galaxies/galaxy.03/index.ts
//
// Galaxy.03 — X Trends + Google News context (TESTING MODE).
//
// Primary data: X v2 GET /2/trends/by/woeid/{id} (App-only Bearer).
// Context enrichment: Google News RSS (free, no auth) — fetched per-trend
// in parallel and passed to Claude as samplePosts so the model has REAL
// breaking news to anchor its draft on, instead of inferring blindly from
// a bare proper noun.
//
// Model: claude-haiku-4-5 — $1 input / $5 output per 1M tokens.
//
// Cost per cycle (5 trends, default):
//   - X API: 1 trends call (essentially free)
//   - Google News: 5 free RSS fetches (~50KB each, no auth)
//   - Claude: 5 × Haiku calls × ~900 in + ~600 out tokens
//     ≈ 5 × $0.0039 = ~$0.02 per cycle (slight bump for news context tokens)
//   - Hourly polling: ~$0.50/day, ~$15/month
//
// Three entry points:
//   - processOpportunity(signals, userPrefs)
//       Brain-compatible. Analyzes one pre-built signal. No X API call.
//   - runTrendsAnalysis({...})
//       Fetches trends and analyzes the top N. Returns StoredOpportunity[].
//   - start({intervalMinutes = 60, ...})
//       Long-running polling loop. Pushes approved opportunities to the
//       shared store on every cycle. Use this for the background process.
//
// Polling default is 60 minutes — trends shift on the order of hours, not
// minutes, so faster polling burns money for no new information.

import Anthropic from '@anthropic-ai/sdk';
import { TwitterApi } from 'twitter-api-v2';
import { GALAXY_03_SYSTEM_PROMPT } from './prompts';
import { UserPreferences, OpportunitySignals } from '@/shared/types';
import { pushOpportunity, StoredOpportunity } from '@/store/opportunity-store';

// ---------------------------------------------------------------------------
// v2 trends — minimal internal shape. SDK v1.29.0 has no typed v2 trends
// bindings, so we hit the endpoint via raw client.v2.get() and map manually.
//
// Response shape per X docs (GET /2/trends/by/woeid/{id}):
//   { data: [{ trend_name: string, tweet_count?: number }],
//     errors?: [{ type, title, detail, status }] }
// ---------------------------------------------------------------------------

type V2TrendItem = { trend_name: string; tweet_count?: number };
type V2TrendsResponse = {
  data?: V2TrendItem[];
  errors?: Array<{ type?: string; title?: string; detail?: string; status?: number }>;
};

/** Normalized trend used internally — agnostic to v1 vs v2 wire shape. */
type Trend = { name: string; tweet_volume: number };

/** A news headline used as context for Claude. Passed via samplePosts. */
type NewsContextItem = {
  source: 'google-news';
  title: string;
  description: string;
  pubDate: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️  AGGRESSIVE TESTING MODE  ⚠️
//
// Set to false to restore production selectivity. This single flag controls:
//   - Default minVolume in trends fetching (0 vs 10000)
//   - Push gate: when true, push if viralityScore >= MIN_SCORE_TESTING (30),
//                regardless of the model's shouldAct verdict. This is paired
//                with prompts.ts being in "always draft" mode — so the store
//                fills with real publishable drafts, not monitor notes.
//                When false, only push if model marks shouldAct = true
//                (which itself uses 55/55 prompt thresholds — see prompts.ts).
//
// The prompts.ts file has a matching marker — both should flip together.
// ─────────────────────────────────────────────────────────────────────────────
const TESTING_MODE = true;

const MIN_SCORE_TESTING = 30; // push anything ≥ 30 score when TESTING_MODE
const DEFAULT_MIN_VOLUME = TESTING_MODE ? 0 : 10_000;

// ---------------------------------------------------------------------------
// Lazy singletons — VP_ANTHROPIC_KEY avoids the empty ANTHROPIC_API_KEY
// Claude Desktop injects into shell environments.
// ---------------------------------------------------------------------------

let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!_anthropic) {
    const apiKey = process.env.VP_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('No Anthropic API key found. Set VP_ANTHROPIC_KEY in .env.local');
    }
    _anthropic = new Anthropic({ apiKey });
  }
  return _anthropic;
}

let _twitter: TwitterApi | null = null;
function getTwitter(): TwitterApi {
  if (!_twitter) {
    const token = process.env.X_BEARER_TOKEN;
    if (!token) throw new Error('X_BEARER_TOKEN is not set.');
    _twitter = new TwitterApi(token.trim());
  }
  return _twitter;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type TrendsAnalysisOptions = {
  userPrefs: UserPreferences;
  /** WOEID. 1 = Worldwide, 23424977 = USA, 23424975 = UK, 23424975 = Japan. */
  woeid?: number;
  /** How many top trends to analyze. Default 5. Each one is ~$0.004 in Claude calls. */
  maxTrends?: number;
  /** Skip trends below this tweet_volume. Default 10000. */
  minVolume?: number;
  /** Skip obvious fandom/spam hashtags via heuristic. Default true. */
  filterNoise?: boolean;
  /** Push approved opportunities to the file store. Default true. */
  pushToStore?: boolean;
};

export type PollOptions = Omit<TrendsAnalysisOptions, 'pushToStore'> & {
  /** How often to poll. Default 60 minutes. Don't go below 20 — trends are slow-moving. */
  intervalMinutes?: number;
};

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

export class Galaxy03 {
  static id = 'galaxy.03';
  static label = 'Galaxy.03 - Pure Trends API (Journalist)';

  private pollCount = 0;
  private pollTimer: NodeJS.Timeout | null = null;

  // -------------------------------------------------------------------------
  // Brain-compatible: analyze a single pre-built signal
  // -------------------------------------------------------------------------
  async processOpportunity(signals: OpportunitySignals, userPrefs: UserPreferences): Promise<any> {
    const response = await getAnthropic().messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      // Lower temp (0.5) for stricter rule adherence in testing mode.
      // The forbidden-phrase list and self-check step need the model to follow
      // instructions literally, not be creative. Bump back to 0.7 in production.
      temperature: TESTING_MODE ? 0.5 : 0.7,
      system: GALAXY_03_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content:
            `User Preferences:\n${JSON.stringify(userPrefs, null, 2)}\n\n` +
            `Trend Signal:\n${JSON.stringify(signals, null, 2)}\n\n` +
            `Triage this trend. If it has real news value AND you can identify the story, ` +
            `write a publish-ready tweet. Otherwise return a monitor/skip note.`,
        },
      ],
    });

    const block = response.content[0];
    const raw = block.type === 'text' ? block.text : '{}';
    return extractJson(raw);
  }

  // -------------------------------------------------------------------------
  // Self-contained: fetch trends from X Trends API and analyze top N
  // -------------------------------------------------------------------------
  async runTrendsAnalysis(opts: TrendsAnalysisOptions): Promise<StoredOpportunity[]> {
    const {
      userPrefs,
      woeid = 1,
      maxTrends = 5,
      minVolume = DEFAULT_MIN_VOLUME,
      filterNoise = true,
      pushToStore = true,
    } = opts;

    const ts = new Date().toLocaleTimeString();
    console.log(`\n─────────────────────────────────────────`);
    console.log(`🌐  Galaxy.03 trends pull   ${ts}${TESTING_MODE ? '  [TESTING MODE]' : ''}`);
    console.log(`    woeid=${woeid}  maxTrends=${maxTrends}  minVolume=${minVolume.toLocaleString()}`);
    console.log(`─────────────────────────────────────────`);

    // 1. Fetch trends from v2 endpoint
    const allTrends = await fetchTrendsV2(woeid, Math.min(50, Math.max(20, maxTrends * 4)));
    console.log(`📥  Received ${allTrends.length} trends from X v2`);

    // 2. Filter and rank
    const candidates = allTrends
      .filter((t) => (t.tweet_volume ?? 0) >= minVolume)
      .filter((t) => (filterNoise ? !isLikelyNoise(t.name) : true))
      .sort((a, b) => (b.tweet_volume ?? 0) - (a.tweet_volume ?? 0))
      .slice(0, maxTrends);

    if (candidates.length === 0) {
      console.log('📭  No trends above threshold after filtering.');
      return [];
    }

    console.log(`📊  Analyzing top ${candidates.length} candidate(s):`);
    for (const c of candidates) {
      console.log(`    • ${c.name}  (${c.tweet_volume?.toLocaleString() ?? 'unknown'} tweets)`);
    }

    // 3a. Enrich each candidate with Google News headlines (parallel, free).
    // This is the unlock — bare proper nouns become drafting-ready when the
    // model can see actual breaking news. Skipped in production (TESTING_MODE off).
    console.log(`📰  Fetching news context for ${candidates.length} trend(s)…`);
    const newsByTrend = await Promise.all(
      candidates.map((t) => (TESTING_MODE ? fetchNewsContext(t.name) : Promise.resolve([])))
    );
    for (let i = 0; i < candidates.length; i++) {
      const n = newsByTrend[i].length;
      if (n > 0) console.log(`    📰 ${candidates[i].name}: ${n} news item(s)`);
    }

    // 3b. Analyze each — one Haiku call per candidate (~$0.004 each)
    const results: StoredOpportunity[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const trend = candidates[i];
      const newsContext = newsByTrend[i];

      const signals: OpportunitySignals = {
        topic: trend.name,
        // Trends API gives total volume, not real-time rate — approximate.
        velocity: Math.round((trend.tweet_volume ?? 100) / 60),
        acceleration: 0,
        avgEngagement: trend.tweet_volume ?? 0,
        trending: true,
        // samplePosts now carries Google News headlines as journalist context
        samplePosts: newsContext,
        timestamp: new Date(),
      };

      try {
        const result = await this.processOpportunity(signals, userPrefs);
        const score = result.viralityScore ?? 0;
        const conf = result.confidence ?? 0;
        const shouldAct = !!result.shouldAct;
        const scoreStr = `score:${score} conf:${conf}% shouldAct:${shouldAct}`;

        // PUSH GATE — different rules for testing vs production.
        // Testing: anything ≥ MIN_SCORE_TESTING (40) lands in the dashboard
        // so we can review borderline drafts. Production: only model-approved
        // (shouldAct) drafts land.
        const shouldPush = TESTING_MODE ? score >= MIN_SCORE_TESTING : shouldAct;

        if (shouldPush) {
          const marker = shouldAct ? '🔥' : '🧪'; // 🧪 = testing-mode override
          console.log(`${marker}  ${trend.name} — ${scoreStr}`);
          const opp: StoredOpportunity = {
            id: `g3_${Date.now()}_${trend.name.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 32)}`,
            topic: trend.name,
            viralityScore: score,
            confidence: conf,
            draft: result.draftTweet ?? '',
            contentAngle: result.contentAngle ?? '',
            imageSearchQuery: result.imageSearchQuery ?? '',
            reasoning: result.reasoning ?? '',
            shouldAct,
            roiEstimate: result.roiEstimate ?? 'medium',
            hashtagSuggestions: result.hashtagSuggestions ?? [],
            optimalPostTime: result.optimalPostTime ?? 'now',
            source: 'detector',
            detectedAt: new Date().toISOString(),
          };
          results.push(opp);
          if (pushToStore) await pushOpportunity(opp);
        } else {
          console.log(`⏭️   ${trend.name} — ${scoreStr}`);
        }
      } catch (err: any) {
        console.error(`❌  Analysis failed for "${trend.name}":`, err.message);
      }
    }

    console.log(`\n✅  Cycle complete. ${results.length} opportunit${results.length === 1 ? 'y' : 'ies'} pushed.`);
    return results;
  }

  // -------------------------------------------------------------------------
  // Polling loop — for the background process
  // -------------------------------------------------------------------------
  async start(opts: PollOptions): Promise<void> {
    const { intervalMinutes = 60, ...analysisOpts } = opts;

    if (intervalMinutes < 20) {
      console.warn(`⚠️  intervalMinutes=${intervalMinutes} is too aggressive — trends shift in hours.`);
    }

    console.log(`\n🚀  Galaxy.03 trends detector starting`);
    console.log(`⏱   Polling every ${intervalMinutes} minutes`);
    console.log(`🎯  woeid=${analysisOpts.woeid ?? 1}  maxTrends=${analysisOpts.maxTrends ?? 5}\n`);

    const tick = async () => {
      this.pollCount++;
      try {
        await this.runTrendsAnalysis(analysisOpts);
      } catch (err: any) {
        console.error(`💥  Cycle #${this.pollCount} failed:`, err.message);
      }
    };

    await tick();

    this.pollTimer = setInterval(tick, intervalMinutes * 60 * 1000);
    process.stdin.resume(); // keep Node alive between polls
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      console.log(`\n🛑  Galaxy.03 detector stopped after ${this.pollCount} cycles.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Google News RSS — free, no auth, gives Claude real breaking-news context
// for each trend keyword. Falls back to empty array on any failure so the
// pipeline degrades gracefully instead of breaking.
// ---------------------------------------------------------------------------

const NEWS_FETCH_TIMEOUT_MS = 5000;

/**
 * Fetch the top N recent news headlines for a topic from Google News RSS.
 * Returns [] on any failure — the prompt is built to fall back to inference
 * when the context is empty.
 */
async function fetchNewsContext(
  topic: string,
  maxItems = 3,
): Promise<NewsContextItem[]> {
  const cleaned = topic.replace(/^#/, '').trim();
  if (!cleaned) return [];
  const q = encodeURIComponent(cleaned);
  const url = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; ViralPulse/1.0; +https://github.com/viralpulse)',
        Accept: 'application/rss+xml,application/xml,text/xml',
      },
      signal: AbortSignal.timeout(NEWS_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRssItems(xml, maxItems);
  } catch {
    // Timeout, network error, parse error — degrade silently to inference mode
    return [];
  }
}

/** Minimal RSS item parser — extracts <title>/<description>/<pubDate> per <item>. */
function parseRssItems(xml: string, maxItems: number): NewsContextItem[] {
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

function extractTag(xml: string, tag: string): string | null {
  // CDATA form: <title><![CDATA[...]]></title>
  const cdataRe = new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`);
  const cdataMatch = xml.match(cdataRe);
  if (cdataMatch) return cdataMatch[1];
  const normalRe = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
  const normalMatch = xml.match(normalRe);
  return normalMatch ? normalMatch[1] : null;
}

function decodeHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, '') // strip HTML tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// X v2 Trends fetch — robust error mapping
// ---------------------------------------------------------------------------

/**
 * Hit GET /2/trends/by/woeid/{woeid} via the SDK's raw v2.get().
 *
 * twitter-api-v2 v1.29.0 has no typed v2 trends bindings — only v1.1
 * `trendsByPlace` — so we call the v2 endpoint via the generic `.get<T>()`
 * inherited from the base client. The SDK prepends the v2 prefix and signs
 * with the Bearer token automatically.
 *
 * Returns trends already normalized to the internal `Trend` shape.
 * Throws actionable errors for the common failure modes.
 */
async function fetchTrendsV2(woeid: number, maxTrends: number): Promise<Trend[]> {
  const path = `trends/by/woeid/${woeid}`;
  const params = {
    max_trends: maxTrends,
    'trend.fields': 'trend_name,tweet_count',
  };

  let response: V2TrendsResponse;
  try {
    response = await getTwitter().v2.get<V2TrendsResponse>(path, params);
  } catch (err: any) {
    throw mapTrendsError(err, woeid);
  }

  // X v2 can return partial errors (data + errors) — surface them when data is empty.
  if ((!response.data || response.data.length === 0) && response.errors?.length) {
    const e = response.errors[0];
    const detail = e.detail ?? e.title ?? e.type ?? 'unknown error';
    throw new Error(`X v2 trends returned errors but no data: ${detail}`);
  }

  return (response.data ?? []).map((t) => ({
    name: t.trend_name,
    tweet_volume: t.tweet_count ?? 0,
  }));
}

/**
 * Translate twitter-api-v2 errors into actionable Galaxy.03 errors.
 * The SDK throws ApiResponseError with a `code` (HTTP status) and `data`
 * (parsed X error body). We map the well-known cases first, then fall back
 * to a generic message that still includes the upstream detail.
 */
function mapTrendsError(err: any, woeid: number): Error {
  const status: number | undefined = err?.code ?? err?.statusCode;
  const apiDetail: string =
    err?.data?.detail || err?.data?.title || err?.data?.error || err?.message || 'Unknown error';

  if (status === 401) {
    return new Error(
      'X auth failed (401). Verify X_BEARER_TOKEN in .env.local is valid and active.',
    );
  }
  if (status === 403) {
    return new Error(
      `X access denied (403): ${apiDetail}. ` +
        `If this is a pay-per-use project, confirm the trends product/scope is enabled ` +
        `and that there are remaining credits.`,
    );
  }
  if (status === 404) {
    return new Error(
      `X v2 trends 404 — endpoint or WOEID not found (woeid=${woeid}). ` +
        `Common WOEIDs: 1 = Worldwide, 23424977 = USA, 23424975 = UK.`,
    );
  }
  if (status === 429) {
    return new Error(
      'X rate limit hit (429). Wait for the window to reset before retrying. ' +
        'Galaxy.03 defaults to hourly polling for exactly this reason.',
    );
  }
  if (status && status >= 500) {
    return new Error(`X v2 trends server error (${status}): ${apiDetail}. Retry later.`);
  }
  return new Error(
    `X v2 trends fetch failed${status ? ` (${status})` : ''}: ${apiDetail}. ` +
      `Endpoint: GET /2/trends/by/woeid/${woeid}.`,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Lightweight noise filter. Heuristic — won't catch everything,
 * but cheaply skips obvious fandom/stan hashtags before we pay Claude.
 */
function isLikelyNoise(name: string): boolean {
  const lower = name.toLowerCase();
  const noisePatterns = [
    /^#?[a-z]+(loves|forever|stan|nation|army|fam|hive)\d*$/i,
    /^#?happy.*day$/i,
    /^#?(rt|like|follow)\b/i,
    /^#?good(morning|night|evening)\b/i,
    /^#?team[a-z]+$/i,
    /^#?bts|blackpink|jimin|jungkook/i, // common k-pop fan tags
  ];
  return noisePatterns.some((re) => re.test(lower));
}

function extractJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {}
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {}
  }
  return { error: 'Failed to parse Galaxy.03 response', raw };
}
