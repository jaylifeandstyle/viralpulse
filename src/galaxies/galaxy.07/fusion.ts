import type { OpportunitySignals } from '@/shared/types';
import type { ContentCandidate, FusedCluster, Platform } from './types';
import { entityOverlap, extractEntities, growthHookBonus } from './shared/keywords';
import { mediaEngagementBoost } from './shared/media';

const FUSION_PLATFORM_BOOST = 18;
const VIDEO_GROWTH_BONUS = 12;

function dominantMediaType(sources: ContentCandidate[]) {
  if (sources.some((s) => s.mediaType === 'video')) return 'video' as const;
  if (sources.some((s) => s.mediaType === 'image')) return 'image' as const;
  return sources[0]?.mediaType ?? 'text';
}

function predictXFit(cluster: {
  tractionScore: number;
  fusionBoost: number;
  primaryTitle: string;
  dominantMediaType: string;
}): number {
  let fit = cluster.tractionScore * 0.6 + cluster.fusionBoost;
  fit += growthHookBonus(cluster.primaryTitle);
  if (cluster.dominantMediaType === 'video') fit += VIDEO_GROWTH_BONUS;
  if (cluster.primaryTitle.length < 90) fit += 5;
  return Math.min(100, Math.round(fit));
}

/**
 * Cluster candidates by entity overlap; boost multi-platform agreement.
 */
export function fuseCandidates(candidates: ContentCandidate[]): FusedCluster[] {
  const clusters: ContentCandidate[][] = [];

  for (const c of candidates) {
    let placed = false;
    for (const cluster of clusters) {
      const anchor = cluster[0];
      const overlap = entityOverlap(c.entities, anchor.entities);
      if (overlap >= 2 || entityOverlap(c.entities, extractEntities(anchor.title)) >= 2) {
        cluster.push(c);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([c]);
  }

  return clusters.map((sources) => {
    const platforms = [...new Set(sources.map((s) => s.platform))] as Platform[];
    const fusionBoost = platforms.length > 1 ? FUSION_PLATFORM_BOOST * (platforms.length - 1) : 0;
    const tractionScore = Math.max(...sources.map((s) => s.tractionScore));
    const primary = [...sources].sort((a, b) => b.tractionScore - a.tractionScore)[0];
    const primaryTitle = primary.title;
    const media = dominantMediaType(sources);

    const base = {
      primaryTitle,
      platforms,
      sources,
      tractionScore,
      fusionBoost,
      dominantMediaType: media,
      sourceUrl: primary.url,
    };

    return {
      ...base,
      predictedXFit: predictXFit({
        tractionScore,
        fusionBoost,
        primaryTitle,
        dominantMediaType: media,
      }),
    };
  });
}

export function rankFusedClusters(clusters: FusedCluster[]): FusedCluster[] {
  return [...clusters].sort((a, b) => {
    const scoreA =
      a.tractionScore + a.fusionBoost + a.predictedXFit * 0.3 + mediaEngagementBoost(a);
    const scoreB =
      b.tractionScore + b.fusionBoost + b.predictedXFit * 0.3 + mediaEngagementBoost(b);
    return scoreB - scoreA;
  });
}

export function clusterToSignals(cluster: FusedCluster): OpportunitySignals {
  return {
    topic: cluster.primaryTitle,
    velocity: Math.round(cluster.tractionScore / 2),
    acceleration: cluster.fusionBoost > 0 ? 1 : 0,
    avgEngagement: cluster.tractionScore,
    trending: cluster.fusionBoost > 0 || cluster.platforms.includes('x-trends'),
    samplePosts: cluster.sources.map((s) => ({
      platform: s.platform,
      title: s.title,
      description: s.description,
      url: s.url,
      tractionScore: s.tractionScore,
      mediaType: s.mediaType,
    })),
    timestamp: new Date(),
    // @ts-expect-error — fusion metadata for prompt
    metadata: {
      galaxyId: 'galaxy.07',
      mode: 'pure_growth',
      platforms: cluster.platforms,
      fusionBoost: cluster.fusionBoost,
      tractionScore: cluster.tractionScore,
      predictedXFit: cluster.predictedXFit,
      mediaType: cluster.dominantMediaType,
      sourceUrl: cluster.sourceUrl,
      sourceCount: cluster.sources.length,
    },
  };
}
