import type { OpportunitySignals, UserPreferences } from '@/shared/types';
import type { StoredOpportunity } from '@/store/opportunity-store';

/** Sub-galaxy variant IDs within galaxy.05 (not Brain-level galaxies). */
export type Galaxy05VariantId = '05.01' | '05.02';

export type HybridAnalysisOptions = {
  userPrefs: UserPreferences;
  /** Sub-variant override. Defaults to GALAXY_05_VARIANT env or 05.02. */
  variant?: Galaxy05VariantId;
  woeid?: number;
  maxTrends?: number;
  maxAnalyze?: number;
  filterNoise?: boolean;
  pushToStore?: boolean;
  autoPost?: boolean;
};

export type PollOptions = Omit<HybridAnalysisOptions, 'pushToStore' | 'autoPost'> & {
  intervalMinutes?: number;
  autoPost?: boolean;
};

export type VariantCycleContext = {
  userPrefs: UserPreferences;
  woeid: number;
  maxTrends: number;
  maxAnalyze: number;
  filterNoise: boolean;
  existing: StoredOpportunity[];
};

/** One item ready for the shared Haiku + push pipeline. */
export type VariantCandidate = {
  topic: string;
  signals: OpportunitySignals;
  imageUrl?: string;
  /** Used in opportunity id: g5_05_02_... */
  idSlug: string;
  logLabel: string;
};

export type VariantCollectResult = {
  candidates: VariantCandidate[];
  /** Extra X API cost beyond trends (usually 0). */
  extraCostUsd?: number;
};

export interface Galaxy05Variant {
  id: Galaxy05VariantId;
  label: string;
  description: string;
  collectCandidates(ctx: VariantCycleContext): Promise<VariantCollectResult>;
  systemPrompt: string;
  buildUserMessage(signals: OpportunitySignals, userPrefs: UserPreferences): string;
}
