import { TwitterApi } from 'twitter-api-v2';
import { X_TRENDS_ESTIMATE_USD } from './constants';

export type Trend = { name: string; tweet_volume: number };

type V2TrendItem = { trend_name: string; tweet_count?: number };
type V2TrendsResponse = {
  data?: V2TrendItem[];
  errors?: Array<{ type?: string; title?: string; detail?: string; status?: number }>;
};

let _twitter: TwitterApi | null = null;

function getTwitter(): TwitterApi {
  if (!_twitter) {
    const token = process.env.X_BEARER_TOKEN;
    if (!token) throw new Error('X_BEARER_TOKEN is not set.');
    _twitter = new TwitterApi(token.trim());
  }
  return _twitter;
}

export async function fetchTrendsV2(woeid: number, maxTrends: number): Promise<Trend[]> {
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

export function isLikelyNoise(name: string): boolean {
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

export { X_TRENDS_ESTIMATE_USD };
