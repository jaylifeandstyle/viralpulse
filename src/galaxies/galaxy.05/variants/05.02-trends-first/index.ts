import type { OpportunitySignals, UserPreferences } from '@/shared/types';
import type {
  Galaxy05Variant,
  VariantCycleContext,
  VariantCollectResult,
  VariantCandidate,
} from '../../types';
import { isTopicAlreadyCovered, slugify } from '../../shared/dedupe';
import {
  fetchTrendsV2,
  isLikelyNoise,
  X_TRENDS_ESTIMATE_USD,
  type Trend,
} from '../../shared/trends';
import { fetchNewsContext } from '../../shared/google-news';
import { PROMPT_05_02 } from './prompts';

type TrendCandidate = Trend & {
  newsContext: Awaited<ReturnType<typeof fetchNewsContext>>;
  hasNewsAnchor: boolean;
};

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
      galaxyVariant: '05.02',
    },
  };
}

export const variant0502: Galaxy05Variant = {
  id: '05.02',
  label: 'X Trends First',
  description:
    'Default G05: rising X trends + Google News anchor, discourse angles, skips G04 dupes.',

  systemPrompt: PROMPT_05_02,

  buildUserMessage(signals: OpportunitySignals, userPrefs: UserPreferences): string {
    return (
      `User Preferences:\n${JSON.stringify(userPrefs, null, 2)}\n\n` +
      `X Trend Signal:\n${JSON.stringify(signals, null, 2)}\n\n` +
      `Write a discourse-angle tweet — do NOT recap the headline. Never write monitor language.`
    );
  },

  async collectCandidates(ctx: VariantCycleContext): Promise<VariantCollectResult> {
    const { woeid, maxTrends, maxAnalyze, filterNoise, existing } = ctx;

    const rawTrends = await fetchTrendsV2(woeid, maxTrends);
    console.log(`📈  [05.02] X Trends: ${rawTrends.length} (~$${X_TRENDS_ESTIMATE_USD.toFixed(2)})`);

    let trends = rawTrends;
    if (filterNoise) {
      trends = trends.filter((t) => !isLikelyNoise(t.name));
    }

    const freshTrends = trends.filter((t) => !isTopicAlreadyCovered(t.name, existing));
    if (freshTrends.length === 0) {
      console.log('📭  [05.02] No new X trends to analyze.');
      return { candidates: [] };
    }

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

    const candidates: VariantCandidate[] = enriched.map((c) => {
      const vol = c.tweet_volume?.toLocaleString() ?? '?';
      const anchor = c.hasNewsAnchor ? `${c.newsContext.length} news` : 'trend-only';
      return {
        topic: c.name,
        signals: trendToSignal(c),
        idSlug: slugify(c.name),
        logLabel: `${c.name} (${vol} posts, ${anchor})`,
      };
    });

    return { candidates };
  },
};
