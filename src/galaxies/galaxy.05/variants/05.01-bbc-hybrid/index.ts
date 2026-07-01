import type { OpportunitySignals, UserPreferences } from '@/shared/types';
import type {
  Galaxy05Variant,
  VariantCycleContext,
  VariantCollectResult,
  VariantCandidate,
} from '../../types';
import { extractKeywords, isTopicAlreadyCovered, slugify } from '../../shared/dedupe';
import {
  fetchTrendsV2,
  isLikelyNoise,
  X_TRENDS_ESTIMATE_USD,
  type Trend,
} from '../../shared/trends';
import {
  fetchBbcCategory,
  diversifyStories,
  type BbcStory,
  type BbcCategory,
} from '../../shared/bbc-rss';
import { PROMPT_05_01 } from './prompts';

const BBC_CATEGORIES: BbcCategory[] = ['WORLD', 'BUSINESS', 'TECHNOLOGY', 'ENTERTAINMENT'];

type RankedStory = BbcStory & {
  localScore: number;
  trendBoost: number;
  matchedTrends: string[];
};

function rankStories(stories: BbcStory[], trends: Trend[]): RankedStory[] {
  return stories.map((story) => {
    const keywords = extractKeywords(story.title);
    const matchedTrends: string[] = [];
    let trendBoost = 0;

    for (const trend of trends) {
      const trendWords = extractKeywords(trend.name);
      const overlap = keywords.filter((k) =>
        trendWords.some((tw) => tw.includes(k) || k.includes(tw) || tw === k),
      );
      if (overlap.length > 0) {
        matchedTrends.push(trend.name);
        trendBoost += 20 + Math.min(overlap.length * 5, 15);
        if ((trend.tweet_volume ?? 0) > 500) trendBoost += 5;
      }
    }

    let recencyBonus = 0;
    const pubMs = Date.parse(story.pubDate);
    if (!Number.isNaN(pubMs)) {
      const ageHours = (Date.now() - pubMs) / (1000 * 60 * 60);
      if (ageHours < 2) recencyBonus = 15;
      else if (ageHours < 6) recencyBonus = 10;
      else if (ageHours < 12) recencyBonus = 5;
    }

    return {
      ...story,
      trendBoost,
      matchedTrends,
      localScore: 30 + trendBoost + recencyBonus,
    };
  });
}

function storyToSignal(story: RankedStory): OpportunitySignals {
  return {
    topic: story.title,
    velocity: story.trendBoost > 0 ? Math.round(story.trendBoost / 2) : 0,
    acceleration: story.matchedTrends.length > 0 ? 1 : 0,
    avgEngagement: 0,
    trending: story.matchedTrends.length > 0,
    samplePosts: [
      {
        source: story.source,
        title: story.title,
        description: story.description,
        pubDate: story.pubDate,
      },
    ],
    timestamp: new Date(),
    // @ts-expect-error — metadata for prompt
    metadata: {
      category: story.category,
      link: story.link,
      matchedTrends: story.matchedTrends,
      trendBoost: story.trendBoost,
      localScore: story.localScore,
      galaxyVariant: '05.01',
    },
  };
}

export const variant0501: Galaxy05Variant = {
  id: '05.01',
  label: 'BBC + X Trends Hybrid',
  description:
    'Original G05: BBC RSS stories ranked by X trend overlap. Overlaps Galaxy.04 — archived for A/B.',

  systemPrompt: PROMPT_05_01,

  buildUserMessage(signals: OpportunitySignals, userPrefs: UserPreferences): string {
    return (
      `User Preferences:\n${JSON.stringify(userPrefs, null, 2)}\n\n` +
      `Hybrid Signal (BBC news + X trend match):\n${JSON.stringify(signals, null, 2)}\n\n` +
      `Write a publish-ready journalist take on this story.`
    );
  },

  async collectCandidates(ctx: VariantCycleContext): Promise<VariantCollectResult> {
    const { woeid, maxTrends, maxAnalyze, filterNoise, existing } = ctx;

    const fetched = await Promise.all(
      BBC_CATEGORIES.map((cat) => fetchBbcCategory(cat, 3)),
    );
    const allStories = diversifyStories(fetched, 1, BBC_CATEGORIES.length);
    if (allStories.length === 0) {
      console.log('📭  [05.01] No BBC stories returned.');
      return { candidates: [] };
    }

    let trends: Trend[] = [];
    try {
      const raw = await fetchTrendsV2(woeid, maxTrends);
      trends = filterNoise ? raw.filter((t) => !isLikelyNoise(t.name)) : raw;
      console.log(`📈  [05.01] X Trends: ${trends.length} (~$${X_TRENDS_ESTIMATE_USD.toFixed(2)})`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️  [05.01] X Trends skipped: ${msg}`);
    }

    const ranked = rankStories(allStories, trends)
      .filter((s) => !isTopicAlreadyCovered(s.title, existing))
      .sort((a, b) => b.localScore - a.localScore)
      .slice(0, maxAnalyze);

    const candidates: VariantCandidate[] = ranked.map((story) => ({
      topic: story.title,
      signals: storyToSignal(story),
      imageUrl: story.imageUrl,
      idSlug: slugify(story.title),
      logLabel: `[${story.category}] score:${story.localScore}${
        story.matchedTrends.length ? ` ↔ ${story.matchedTrends.slice(0, 2).join(', ')}` : ''
      } ${story.title.slice(0, 50)}`,
    }));

    return { candidates };
  },
};
