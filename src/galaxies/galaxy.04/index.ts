// src/galaxies/galaxy.04/index.ts
//
// Galaxy.04 — Diverse News-First Journalist Engine.
//
// Strategy: instead of starting from X Trends (heavily sports-biased on
// bare keywords) and enriching with news, start FROM news directly. Pull
// top stories from BBC News RSS across 6 categories in parallel, ensure
// category diversity, then run each through Haiku as a fully-contextualized
// signal.
//
// Why BBC RSS over Google News:
//   - Direct publisher article URLs (Google News uses encoded JS-redirect
//     URLs that can't be resolved server-side)
//   - <media:thumbnail> tag on every item → instant hero image, no second
//     fetch, no fragile entity extraction. The "Post Now" modal pre-fills
//     the Image URL field straight from this.
//   - ~100% image coverage across categories
//
// Why this is better than Galaxy.03:
//   - Diversity guaranteed by category fan-out (politics, tech, biz, sports,
//     entertainment, science) — sports can't dominate
//   - Stories arrive with title + description + hero image already → no
//     "infer angle from bare keyword" failure mode, no image-lookup work
//   - Higher confidence drafts → more pushable opportunities per cycle
//
// Cost per cycle (6-8 stories, default):
//   - BBC RSS: 6 free RSS fetches (~50KB each, images included in feed)
//   - Claude: 6-8 × Haiku calls × ~700 in + ~600 out tokens
//     ≈ 6 × $0.0037 = $0.022 typical, logged per cycle
//   - Hourly polling: ~$0.50/day, ~$15/month
//
// Three entry points (same shape as Galaxy.03 for Brain compatibility):
//   - processOpportunity(signals, userPrefs) — Brain-compatible
//   - runNewsAnalysis({...}) — fetches diverse news, analyzes, pushes
//   - start({intervalMinutes = 60, ...}) — polling loop

import Anthropic from '@anthropic-ai/sdk';
import { GALAXY_04_SYSTEM_PROMPT } from './prompts';
import { UserPreferences, OpportunitySignals } from '@/shared/types';
import { pushOpportunity, StoredOpportunity } from '@/store/opportunity-store';

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️  TESTING MODE — same convention as Galaxy.03
// Set to false to restore strict thresholds (shouldAct gate only).
// ─────────────────────────────────────────────────────────────────────────────
const TESTING_MODE = true;

const MIN_SCORE_TESTING = 35; // push anything ≥ 35 score when TESTING_MODE

// Haiku 4.5 pricing — used for per-cycle cost logging.
const HAIKU_INPUT_USD_PER_M = 1.0;
const HAIKU_OUTPUT_USD_PER_M = 5.0;

// ---------------------------------------------------------------------------
// News categories — Google News RSS topic IDs.
// These topic codes have been stable for years and are publicly documented.
// Tweak the list (or pass `categories` into runNewsAnalysis) to rebalance.
// ---------------------------------------------------------------------------

const DEFAULT_CATEGORIES: NewsCategory[] = [
  'WORLD',
  'NATION',
  'BUSINESS',
  'TECHNOLOGY',
  'ENTERTAINMENT',
  'SPORTS',
];

type NewsCategory =
  | 'TOP' // top stories (no category)
  | 'WORLD'
  | 'NATION'
  | 'BUSINESS'
  | 'TECHNOLOGY'
  | 'ENTERTAINMENT'
  | 'SPORTS'
  | 'SCIENCE'
  | 'HEALTH';

type NewsStory = {
  source: 'bbc';
  category: NewsCategory;
  title: string;
  description: string;
  link: string;
  pubDate: string;
  /** Publisher's hero image, when the RSS includes <media:thumbnail> */
  imageUrl?: string;
};

// ---------------------------------------------------------------------------
// Lazy Anthropic client (VP_ANTHROPIC_KEY first — Claude Desktop quirk)
// ---------------------------------------------------------------------------

let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!_anthropic) {
    const apiKey = process.env.VP_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('No Anthropic API key. Set VP_ANTHROPIC_KEY in .env.local');
    _anthropic = new Anthropic({ apiKey });
  }
  return _anthropic;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type NewsAnalysisOptions = {
  userPrefs: UserPreferences;
  /** Which categories to fetch. Defaults to 6 diverse buckets. */
  categories?: NewsCategory[];
  /** How many stories per category to consider before picking. Default 5. */
  perCategoryFetch?: number;
  /** How many top stories per category to actually analyze. Default 1. */
  perCategoryPick?: number;
  /** Hard cap on stories per cycle (across all categories). Default 8. */
  maxStories?: number;
  /** Push approved opportunities to the shared store. Default true. */
  pushToStore?: boolean;
};

export type PollOptions = Omit<NewsAnalysisOptions, 'pushToStore'> & {
  /** Default 60 minutes — news refreshes fastest at top-of-the-hour scale. */
  intervalMinutes?: number;
};

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

export class Galaxy04 {
  static id = 'galaxy.04';
  static label = 'Galaxy.04 - Diverse News-First Journalist';

  private pollCount = 0;
  private pollTimer: NodeJS.Timeout | null = null;

  // -------------------------------------------------------------------------
  // Brain-compatible: analyze a single signal (no news fetch)
  // -------------------------------------------------------------------------
  async processOpportunity(signals: OpportunitySignals, userPrefs: UserPreferences): Promise<any> {
    const { result } = await this._processWithUsage(signals, userPrefs);
    return result;
  }

  /** Internal — returns parsed result + token usage so callers can track cost. */
  private async _processWithUsage(
    signals: OpportunitySignals,
    userPrefs: UserPreferences,
  ): Promise<{ result: any; inputTokens: number; outputTokens: number }> {
    const response = await getAnthropic().messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      temperature: TESTING_MODE ? 0.5 : 0.7,
      system: GALAXY_04_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content:
            `User Preferences:\n${JSON.stringify(userPrefs, null, 2)}\n\n` +
            `News Signal:\n${JSON.stringify(signals, null, 2)}\n\n` +
            `Write a publish-ready journalist take. Anchor on the story facts. Never write monitor language.`,
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

  // -------------------------------------------------------------------------
  // Self-contained: fetch diverse news + analyze + push
  // -------------------------------------------------------------------------
  async runNewsAnalysis(opts: NewsAnalysisOptions): Promise<StoredOpportunity[]> {
    const {
      userPrefs,
      categories = DEFAULT_CATEGORIES,
      perCategoryFetch = 5,
      perCategoryPick = 1,
      maxStories = 8,
      pushToStore = true,
    } = opts;

    const ts = new Date().toLocaleTimeString();
    console.log(`\n─────────────────────────────────────────`);
    console.log(`📰  Galaxy.04 news pull   ${ts}${TESTING_MODE ? '  [TESTING MODE]' : ''}`);
    console.log(`    categories=[${categories.join(', ')}]  pick=${perCategoryPick}/${perCategoryFetch}  cap=${maxStories}`);
    console.log(`─────────────────────────────────────────`);

    // 1. Fetch news from every category in parallel.
    // BBC RSS items include <media:thumbnail> tags so we get the publisher's
    // chosen hero image directly — no second HTTP fetch needed.
    const fetched = await Promise.all(
      categories.map((cat) => fetchBbcNewsCategory(cat, perCategoryFetch)),
    );

    // 2. Diversify — take perCategoryPick from each, cap at maxStories total
    const stories = diversifyStories(fetched, perCategoryPick, maxStories);

    if (stories.length === 0) {
      console.log('📭  No news returned from any category. Network issue?');
      return [];
    }

    console.log(`📊  Analyzing ${stories.length} stor${stories.length === 1 ? 'y' : 'ies'}:`);
    for (const s of stories) {
      console.log(`    • [${s.category}] ${truncate(s.title, 80)}`);
    }

    // 3. Hero images already in the RSS — no second fetch needed.
    const hitCount = stories.filter(s => s.imageUrl).length;
    console.log(`🖼  ${hitCount}/${stories.length} stories have a hero image from the RSS`);

    // Analyze each — track cost as we go
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const results: StoredOpportunity[] = [];

    for (let storyIdx = 0; storyIdx < stories.length; storyIdx++) {
      const story = stories[storyIdx];
      const heroImage = story.imageUrl ?? '';
      const signals = storyToSignal(story);

      try {
        const { result, inputTokens, outputTokens } = await this._processWithUsage(signals, userPrefs);
        totalInputTokens += inputTokens;
        totalOutputTokens += outputTokens;

        const score = result.viralityScore ?? 0;
        const conf = result.confidence ?? 0;
        const shouldAct = !!result.shouldAct;
        const scoreStr = `score:${score} conf:${conf}% shouldAct:${shouldAct}`;

        const shouldPush = TESTING_MODE ? score >= MIN_SCORE_TESTING : shouldAct;

        if (shouldPush) {
          const marker = shouldAct ? '🔥' : '🧪';
          console.log(`${marker}  [${story.category}] ${scoreStr}`);
          const opp: StoredOpportunity = {
            id: `g4_${Date.now()}_${story.title.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 32)}`,
            topic: story.title,
            viralityScore: score,
            confidence: conf,
            draft: result.draftTweet ?? '',
            contentAngle: result.contentAngle ?? '',
            imageSearchQuery: result.imageSearchQuery ?? '',
            imageUrl: heroImage || undefined, // og:image from publisher
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
          console.log(`⏭️   [${story.category}] ${scoreStr}`);
        }
      } catch (err: any) {
        console.error(`❌  Analysis failed for "${truncate(story.title, 50)}":`, err.message);
      }
    }

    // 4. Cost summary
    const inputCost = (totalInputTokens / 1_000_000) * HAIKU_INPUT_USD_PER_M;
    const outputCost = (totalOutputTokens / 1_000_000) * HAIKU_OUTPUT_USD_PER_M;
    const totalCost = inputCost + outputCost;

    console.log(`\n💰  Cycle cost: $${totalCost.toFixed(4)}  (${totalInputTokens} in + ${totalOutputTokens} out tokens)`);
    console.log(`    Projected: $${(totalCost * 24).toFixed(2)}/day at hourly polling, $${(totalCost * 24 * 30).toFixed(2)}/month`);
    console.log(`✅  ${results.length} opportunit${results.length === 1 ? 'y' : 'ies'} pushed.\n`);

    return results;
  }

  // -------------------------------------------------------------------------
  // Polling loop
  // -------------------------------------------------------------------------
  async start(opts: PollOptions): Promise<void> {
    const { intervalMinutes = 60, ...analysisOpts } = opts;
    if (intervalMinutes < 15) {
      console.warn(`⚠️  intervalMinutes=${intervalMinutes} is aggressive — news shifts slowly.`);
    }

    console.log(`\n🚀  Galaxy.04 news detector starting`);
    console.log(`⏱   Polling every ${intervalMinutes} minutes\n`);

    const tick = async () => {
      this.pollCount++;
      try {
        await this.runNewsAnalysis(analysisOpts);
      } catch (err: any) {
        console.error(`💥  Cycle #${this.pollCount} failed:`, err.message);
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
      console.log(`\n🛑  Galaxy.04 detector stopped after ${this.pollCount} cycles.`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — news collection
// ─────────────────────────────────────────────────────────────────────────────

const NEWS_FETCH_TIMEOUT_MS = 6000;

/**
 * BBC News RSS endpoint per category. We switched from Google News because
 * Google's RSS items use encoded redirect URLs (CBMi…) that resolve client-
 * side only — so we couldn't extract og:images server-side. BBC ships the
 * publisher's chosen hero image right in the RSS via <media:thumbnail>,
 * giving us ~100% image coverage on every story for free.
 */
function bbcRssUrl(category: NewsCategory): string {
  const path = BBC_CATEGORY_PATHS[category];
  return `https://feeds.bbci.co.uk/${path}/rss.xml`;
}

const BBC_CATEGORY_PATHS: Record<NewsCategory, string> = {
  TOP: 'news',
  WORLD: 'news/world',
  // BBC's standalone us-canada feed is empty; the world/us_and_canada
  // subsection has populated items.
  NATION: 'news/world/us_and_canada',
  BUSINESS: 'news/business',
  TECHNOLOGY: 'news/technology',
  ENTERTAINMENT: 'news/entertainment_and_arts',
  // Sport lives under a different path (no /news/ prefix)
  SPORTS: 'sport',
  SCIENCE: 'news/science_and_environment',
  HEALTH: 'news/health',
};

async function fetchBbcNewsCategory(
  category: NewsCategory,
  maxItems: number,
): Promise<NewsStory[]> {
  try {
    const res = await fetch(bbcRssUrl(category), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ViralPulse/1.0)',
        Accept: 'application/rss+xml,application/xml,text/xml',
      },
      signal: AbortSignal.timeout(NEWS_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    return parseRssItems(await res.text(), category, maxItems);
  } catch {
    return [];
  }
}

/**
 * Pick perCategoryPick stories from each category, capped at maxStories total.
 * Round-robin to keep early categories from filling the cap.
 */
function diversifyStories(
  fetched: NewsStory[][],
  perCategoryPick: number,
  maxStories: number,
): NewsStory[] {
  const out: NewsStory[] = [];
  for (let i = 0; i < perCategoryPick && out.length < maxStories; i++) {
    for (const bucket of fetched) {
      if (out.length >= maxStories) break;
      const candidate = bucket[i];
      if (candidate && !isDuplicate(candidate, out)) out.push(candidate);
    }
  }
  return out;
}

/** Skip near-duplicates by comparing the first meaningful 6 words of titles. */
function isDuplicate(candidate: NewsStory, accepted: NewsStory[]): boolean {
  const key = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 6)
      .join(' ');
  const candidateKey = key(candidate.title);
  if (!candidateKey) return false;
  return accepted.some((s) => key(s.title) === candidateKey);
}

function storyToSignal(story: NewsStory): OpportunitySignals {
  return {
    topic: story.title,
    velocity: 0,
    acceleration: 0,
    avgEngagement: 0,
    trending: true,
    samplePosts: [
      {
        source: story.source,
        title: story.title,
        description: story.description,
        pubDate: story.pubDate,
      },
    ],
    timestamp: new Date(),
    // @ts-expect-error — adding category as out-of-band metadata for prompt context
    metadata: { category: story.category, link: story.link },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — RSS parsing (minimal, no deps)
// ─────────────────────────────────────────────────────────────────────────────

function parseRssItems(xml: string, category: NewsCategory, maxItems: number): NewsStory[] {
  const items: NewsStory[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;
  while ((match = itemRe.exec(xml)) !== null && items.length < maxItems) {
    const block = match[1];
    const title = extractTag(block, 'title');
    if (!title) continue;
    items.push({
      source: 'bbc',
      category,
      title: decodeHtml(title).slice(0, 240),
      description: decodeHtml(extractTag(block, 'description') ?? '').slice(0, 280),
      link: decodeHtml(extractTag(block, 'link') ?? '').slice(0, 400),
      pubDate: (extractTag(block, 'pubDate') ?? '').slice(0, 32),
      imageUrl: extractMediaThumbnail(block),
    });
  }
  return items;
}

/**
 * Pull the image URL out of `<media:thumbnail url="..." />`. BBC ships the
 * 240px-wide variant; we upsize via URL rewrite to 800px for X (their
 * image CDN serves any width in the /ace/standard/{N}/... path).
 */
function extractMediaThumbnail(itemBlock: string): string | undefined {
  const m = itemBlock.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i);
  if (!m) return undefined;
  const raw = decodeHtml(m[1]);
  // /ace/standard/240/... → /ace/standard/800/... for better quality
  return raw.replace(/\/ace\/standard\/\d+\//, '/ace/standard/800/');
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

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function extractJson(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw); } catch {}
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(stripped); } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return { error: 'Failed to parse Galaxy.04 response', raw };
}
