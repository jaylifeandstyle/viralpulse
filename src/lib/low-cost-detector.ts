/**
 * src/lib/low-cost-detector.ts
 *
 * Low-cost opportunity detector.
 *
 * Cost model per poll cycle (default: every 20 min):
 *   • 1 × searchRecent call (combined OR query, max_results=100) ← very cheap
 *   • 0–3 × Galaxy.02 / Claude calls (only for high-engagement candidates)
 *
 * The Filtered Stream is intentionally NOT used — it requires Basic tier
 * and holds a persistent connection. This approach works on Free/Basic
 * and costs almost nothing.
 */
import { TwitterApi, TweetV2 } from 'twitter-api-v2';
import { brain } from '@/brain';
import { pushOpportunity, StoredOpportunity } from '@/store/opportunity-store';
import { OpportunitySignals, UserPreferences } from '@/shared/types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Topics to watch. All are OR'd into one query — 1 API call regardless of count. */
const WATCH_TOPICS = [
  'Apple', 'OpenAI', 'Elon Musk', 'AI', 'Trump', 'Tesla',
  'crypto', 'Google', 'Meta', 'Microsoft', 'Fed', 'breaking',
];

/**
 * Built once at startup.
 * Example: (Apple OR OpenAI OR "Elon Musk" OR AI OR Trump) -is:retweet lang:en
 */
const COMBINED_QUERY =
  WATCH_TOPICS.map(t => (t.includes(' ') ? `"${t}"` : t)).join(' OR ') +
  ' -is:retweet lang:en';

/** Skip a topic unless it appears in at least this many tweets per poll. */
const MIN_TWEET_COUNT = 5; // Lower to 1 in dev for free-tier testing

/** Skip a topic unless its average like count clears this bar. */
const MIN_AVG_LIKES = 30; // Lower to 0 in dev — free tier tweets average 0-1 likes

/** Max Galaxy.02 calls per cycle — hard ceiling on AI spend. */
const MAX_BRAIN_CALLS = 3;

/** Minimum Galaxy.02 viralityScore to push to the dashboard. */
const MIN_VIRALITY_TO_PUSH = 65; // Lower to 10 in dev for free-tier testing

// Default user prefs — journalist account profile.
// Replace with real user prefs once auth is added.
const DEFAULT_USER_PREFS: UserPreferences = {
  userId: 'detector-auto',
  mode: 'pure_growth',
  aggressiveness: 7,
  weeklyFollowerTarget: 1000,
  niches: ['breaking news', 'politics', 'technology', 'AI', 'business'],
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TopicStats = {
  topic: string;
  tweetCount: number;
  totalLikes: number;
  totalRetweets: number;
  avgLikes: number;
  avgRetweets: number;
  samples: TweetV2[];
};

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

export class LowCostDetector {
  private client: TwitterApi;
  private pollCount = 0;

  constructor() {
    const token = process.env.X_BEARER_TOKEN;
    if (!token) throw new Error('X_BEARER_TOKEN is not set.');
    this.client = new TwitterApi(token.trim());
  }

  // -------------------------------------------------------------------------
  // Public
  // -------------------------------------------------------------------------

  async runOnce(): Promise<void> {
    this.pollCount++;
    const ts = new Date().toLocaleTimeString();
    console.log(`\n─────────────────────────────────────────`);
    console.log(`🔍  Poll #${this.pollCount}  ${ts}`);
    console.log(`─────────────────────────────────────────`);

    const stats = await this.fetchAndScore();

    const candidates = stats
      .filter(s => s.tweetCount >= MIN_TWEET_COUNT && s.avgLikes >= MIN_AVG_LIKES)
      .sort((a, b) => (b.avgLikes + b.avgRetweets * 3) - (a.avgLikes + a.avgRetweets * 3))
      .slice(0, MAX_BRAIN_CALLS);

    if (candidates.length === 0) {
      console.log('📭  No topics above threshold this cycle.');
      return;
    }

    console.log(`📊  ${candidates.length} candidate(s) queued for Brain analysis:`);
    for (const c of candidates) {
      console.log(`    • "${c.topic}" — ${c.tweetCount} tweets, avg ${c.avgLikes} likes`);
    }

    for (const c of candidates) {
      await this.analyzeWithBrain(c);
    }
  }

  /**
   * Start the detector loop.
   * @param intervalMinutes How often to poll (default 20 min).
   */
  async start(intervalMinutes = 20): Promise<void> {
    console.log(`\n🚀  Low-Cost Detector starting`);
    console.log(`⏱   Polling every ${intervalMinutes} minutes`);
    console.log(`📋  Watching: ${WATCH_TOPICS.join(', ')}\n`);

    await this.runOnce();

    const ms = intervalMinutes * 60 * 1000;
    setInterval(() => this.runOnce().catch(err => console.error('Poll error:', err.message)), ms);

    // Keep the Node process alive between polls
    process.stdin.resume();
  }

  // -------------------------------------------------------------------------
  // Private — data collection
  // -------------------------------------------------------------------------

  private async fetchAndScore(): Promise<TopicStats[]> {
    let tweets: TweetV2[];
    try {
      const response = await this.client.v2.search(COMBINED_QUERY, {
        max_results: 100,
        'tweet.fields': ['public_metrics', 'text', 'created_at', 'author_id'],
      });
      tweets = response.tweets; // flat TweetV2[] from the paginator
    } catch (err: any) {
      console.error('❌  Search API error:', err.message);
      return [];
    }

    if (!tweets.length) {
      console.log('ℹ️   Search returned 0 tweets.');
      return [];
    }

    console.log(`📥  Fetched ${tweets.length} tweets`);

    // Bucket tweets by which watch topic they mention
    const buckets = new Map<string, TopicStats>();
    for (const topic of WATCH_TOPICS) {
      buckets.set(topic, {
        topic,
        tweetCount: 0,
        totalLikes: 0,
        totalRetweets: 0,
        avgLikes: 0,
        avgRetweets: 0,
        samples: [],
      });
    }

    for (const tweet of tweets) {
      const lower = tweet.text.toLowerCase();
      for (const topic of WATCH_TOPICS) {
        if (lower.includes(topic.toLowerCase())) {
          const b = buckets.get(topic)!;
          b.tweetCount++;
          b.totalLikes += tweet.public_metrics?.like_count ?? 0;
          b.totalRetweets += tweet.public_metrics?.retweet_count ?? 0;
          if (b.samples.length < 3) b.samples.push(tweet);
        }
      }
    }

    // Compute averages and return all non-empty buckets
    const results: TopicStats[] = [];
    for (const b of buckets.values()) {
      if (b.tweetCount > 0) {
        b.avgLikes = Math.round(b.totalLikes / b.tweetCount);
        b.avgRetweets = Math.round(b.totalRetweets / b.tweetCount);
        results.push(b);
      }
    }
    return results;
  }

  // -------------------------------------------------------------------------
  // Private — Brain analysis
  // -------------------------------------------------------------------------

  private async analyzeWithBrain(stats: TopicStats): Promise<void> {
    console.log(`\n🧠  Analyzing: "${stats.topic}"`);

    const signals: OpportunitySignals = {
      topic: stats.topic,
      // Scale the per-window count to an estimated hourly rate.
      // 100-tweet window every 20 min → multiply by 3 for rough posts/hour.
      velocity: stats.tweetCount * 3,
      acceleration: stats.avgRetweets * 5,
      avgEngagement: stats.avgLikes,
      trending: stats.avgLikes > 500,
      samplePosts: stats.samples.map((t, i) => ({
        id: t.id ?? `sample_${i}`,
        text: t.text,
        likeCount: t.public_metrics?.like_count ?? 0,
        retweetCount: t.public_metrics?.retweet_count ?? 0,
      })),
      timestamp: new Date(),
    };

    try {
      const result = await brain.processOpportunity(signals, DEFAULT_USER_PREFS);

      const scoreStr = `score:${result.viralityScore} conf:${result.confidence}% shouldAct:${result.shouldAct}`;

      if (result.viralityScore >= MIN_VIRALITY_TO_PUSH) {
        console.log(`🔥  HOT — ${scoreStr}`);
        const opp: StoredOpportunity = {
          id: `${Date.now()}_${stats.topic.replace(/\s+/g, '_')}`,
          topic: stats.topic,
          viralityScore: result.viralityScore,
          confidence: result.confidence,
          draft: result.draftTweet ?? '',
          contentAngle: result.contentAngle ?? '',
          imageSearchQuery: result.imageSearchQuery ?? '',
          reasoning: result.reasoning ?? '',
          shouldAct: result.shouldAct,
          roiEstimate: result.roiEstimate ?? 'medium',
          hashtagSuggestions: result.hashtagSuggestions ?? [],
          optimalPostTime: result.optimalPostTime ?? 'now',
          source: 'detector',
          detectedAt: new Date().toISOString(),
        };
        await pushOpportunity(opp);
        console.log(`✅  Pushed to dashboard store.`);
      } else {
        console.log(`⏭️   Skip — ${scoreStr}`);
      }
    } catch (err: any) {
      console.error(`❌  Brain error for "${stats.topic}":`, err.message);
    }
  }
}
