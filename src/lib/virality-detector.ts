import { TwitterApi, TweetStream, ApiResponseError } from 'twitter-api-v2';
import { OpportunitySignals } from '@/shared/types';
import { brain } from '@/brain';

export class ViralityDetector {
  private client: TwitterApi;
  private activeStream: TweetStream | null = null;

  constructor() {
    const token = process.env.X_BEARER_TOKEN;
    if (!token) throw new Error('X_BEARER_TOKEN is not set in environment variables.');
    this.client = new TwitterApi(token.trim());
  }

  /**
   * Clears any existing rules for this userId then adds the new ones.
   * Throws if rule registration fails — callers must handle this before
   * calling start().
   */
  async addMonitoringRules(userId: string, niches: string[]): Promise<void> {
    if (niches.length === 0) throw new Error('niches array must not be empty.');

    // Remove stale rules for this user before adding new ones.
    // X rejects duplicate rules with a 409, so this is always required.
    await this.removeRulesForUser(userId);

    const rules = niches.map((niche, i) => ({
      value: `${niche} -is:retweet lang:en`,
      tag: `user_${userId}_niche_${i}`,
    }));

    console.log(`⏳ Adding ${rules.length} monitoring rule(s) for user "${userId}"...`);

    try {
      const result = await this.client.v2.updateStreamRules({ add: rules });

      if (result.errors?.length) {
        // X accepted the request but flagged individual rule errors inline
        const messages = result.errors.map((e: any) => e.message ?? JSON.stringify(e)).join(', ');
        throw new Error(`X rejected one or more rules: ${messages}`);
      }

      const added = result.data?.length ?? 0;
      console.log(`✅ ${added} rule(s) active on X for user "${userId}"`);
      rules.forEach(r => console.log(`   → ${r.value}`));
    } catch (error: unknown) {
      if (error instanceof ApiResponseError) {
        throw new Error(
          `Failed to register stream rules (HTTP ${error.code}).\n` +
          `X says: "${error.data?.detail ?? error.data?.title ?? 'no detail'}"\n` +
          `Check that your app has at least Basic tier access.`
        );
      }
      throw error;
    }
  }

  /**
   * Verifies active rules exist on X, then opens the filtered stream.
   * Throws immediately with a clear message for 401, 403, and 409.
   */
  async start(): Promise<void> {
    if (this.activeStream) {
      console.log('Stream is already running.');
      return;
    }

    // Verify rules exist on X's side before connecting.
    // This is what prevents the 409 "no rules defined" error.
    await this.assertRulesExist();

    console.log('🚀 Starting Virality Detection Stream...');

    try {
      this.activeStream = await this.client.v2.searchStream({
        'tweet.fields': ['created_at', 'public_metrics', 'author_id', 'text'],
        expansions: ['author_id'],
      });
    } catch (error: unknown) {
      this.activeStream = null;
      throw this.wrapStreamError(error);
    }

    for await (const event of this.activeStream) {
      const tweet = event.data;
      if (!tweet?.text) continue;

      const topic = this.extractMainTopic(tweet.text);
      if (!topic) continue;

      const likeCount = tweet.public_metrics?.like_count ?? 0;
      const retweetCount = tweet.public_metrics?.retweet_count ?? 0;

      const signals: OpportunitySignals = {
        topic,
        velocity: likeCount + retweetCount * 3,
        acceleration: retweetCount * 5,
        avgEngagement: likeCount,
        trending: false,
        samplePosts: [{
          id: tweet.id,
          text: tweet.text.substring(0, 250),
          likeCount,
          retweetCount,
        }],
        timestamp: new Date(),
      };

      try {
        const result = await brain.processOpportunity(signals, {
          userId: 'current-user', // TODO: replace with real user lookup
          mode: 'pure_growth',
          aggressiveness: 8,
          weeklyFollowerTarget: 1000,
          niches: [],
        });

        if (result?.viralityScore >= 75) {
          console.log(`🔥 HOT OPPORTUNITY: ${topic} | Score: ${result.viralityScore}`);
        }
      } catch (err) {
        console.error('Error in Brain:', err);
      }
    }
  }

  stop(): void {
    if (this.activeStream) {
      this.activeStream.close();
      this.activeStream = null;
      console.log('🛑 Virality stream stopped.');
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async assertRulesExist(): Promise<void> {
    let existing;
    try {
      existing = await this.client.v2.streamRules();
    } catch (error: unknown) {
      throw this.wrapStreamError(error);
    }

    const count = existing.data?.length ?? 0;
    if (count === 0) {
      throw new Error(
        'No stream rules are active on X. ' +
        'Call addMonitoringRules(userId, niches) successfully before calling start().'
      );
    }

    console.log(`✅ ${count} active rule(s) confirmed on X before connecting.`);
  }

  private async removeRulesForUser(userId: string): Promise<void> {
    let existing;
    try {
      existing = await this.client.v2.streamRules();
    } catch {
      // If we can't fetch rules (e.g. no rules exist yet), nothing to delete.
      return;
    }

    const prefix = `user_${userId}_`;
    const toDelete = (existing.data ?? [])
      .filter(r => r.tag?.startsWith(prefix))
      .map(r => r.id);

    if (toDelete.length === 0) return;

    await this.client.v2.updateStreamRules({ delete: { ids: toDelete } });
    console.log(`🗑  Removed ${toDelete.length} stale rule(s) for user "${userId}".`);
  }

  private wrapStreamError(error: unknown): Error {
    if (!(error instanceof ApiResponseError)) return error as Error;

    const detail = error.data?.detail ?? error.data?.title ?? 'no detail returned';

    if (error.code === 401 || error.isAuthError) {
      return new Error(
        `401 Unauthorized — Bearer Token rejected.\n` +
        `X says: "${detail}"\n` +
        `Fix: developer.x.com → your Project → your App → Keys and Tokens → regenerate Bearer Token.`
      );
    }
    if (error.code === 403) {
      return new Error(
        `403 Forbidden — This app lacks Filtered Stream access.\n` +
        `X says: "${detail}"\n` +
        `Fix: Upgrade to Basic tier at developer.x.com/en/portal/products.`
      );
    }
    if (error.code === 409) {
      return new Error(
        `409 Conflict — No active rules on X.\n` +
        `X says: "${detail}"\n` +
        `Fix: Call addMonitoringRules() before start().`
      );
    }

    return new Error(`X API error (HTTP ${error.code}): ${detail}`);
  }

  private extractMainTopic(text: string): string | null {
    const keywords = [
      'Apple', 'iPhone', 'Trump', 'Elon', 'Musk', 'AI', 'OpenAI',
      'Tesla', 'Google', 'Meta', 'breaking', 'announce',
    ];
    const lower = text.toLowerCase();
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) return kw;
    }
    return null;
  }
}

export const viralityDetector = new ViralityDetector();
