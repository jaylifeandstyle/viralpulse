import type { OpportunitySignals, UserPreferences } from '@/shared/types';

export type Platform = 'reddit' | 'hackernews' | 'youtube' | 'x-trends';

export type MediaType = 'text' | 'video' | 'link' | 'image';

/** Normalized item from any adapter before fusion. */
export type ContentCandidate = {
  id: string;
  platform: Platform;
  title: string;
  url?: string;
  description?: string;
  mediaType: MediaType;
  /** Normalized 0–100 traction from platform metrics. */
  tractionScore: number;
  rawMetrics: {
    score?: number;
    comments?: number;
    views?: number;
    ageHours?: number;
  };
  entities: string[];
  publishedAt?: string;
  /** Distinct image URLs from the source (thumbnails, previews). */
  imageUrls?: string[];
  /** Direct MP4 URL uploadable to X (e.g. Reddit v.redd.it). */
  directVideoUrl?: string;
};

export type FusedCluster = {
  primaryTitle: string;
  platforms: Platform[];
  sources: ContentCandidate[];
  tractionScore: number;
  fusionBoost: number;
  predictedXFit: number;
  dominantMediaType: MediaType;
  sourceUrl?: string;
  /** Resolved media for posting (G07 only). */
  imageUrls?: string[];
  videoUrl?: string;
};

export type FusionAnalysisOptions = {
  userPrefs: UserPreferences;
  maxAnalyze?: number;
  /** Include optional X Trends adapter (~$0.01). Default true if token set. */
  includeXTrends?: boolean;
  pushToStore?: boolean;
};

export type PollOptions = FusionAnalysisOptions & {
  intervalMinutes?: number;
};

export type AnalysisCandidate = {
  topic: string;
  signals: OpportunitySignals;
  idSlug: string;
  logLabel: string;
  fusion: FusedCluster;
};
