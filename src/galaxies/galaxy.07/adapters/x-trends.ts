import type { ContentCandidate } from '../types';
import { extractEntities } from '../shared/keywords';
import { fetchTrendsV2 } from '@/galaxies/galaxy.05/shared/trends';

/** Map X trends to ContentCandidates for fusion (~$0.01/cycle). */
export async function fetchXTrendCandidates(
  woeid = 1,
  maxTrends = 10,
): Promise<ContentCandidate[]> {
  if (!process.env.X_BEARER_TOKEN) return [];

  const trends = await fetchTrendsV2(woeid, maxTrends);
  return trends.map((t) => {
    const volume = t.tweet_volume ?? 0;
    const tractionScore = Math.min(100, Math.round(Math.log10(Math.max(volume, 10)) * 25));
    return {
      id: `x_${t.name.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 40)}`,
      platform: 'x-trends' as const,
      title: t.name,
      description: `${volume.toLocaleString()} posts on X`,
      mediaType: 'text' as const,
      tractionScore,
      rawMetrics: { score: volume },
      entities: extractEntities(t.name),
    };
  });
}
