// src/store/store-shared.ts
//
// Shared types + invariants for both store backends (file + KV).
// The dispatcher in opportunity-store.ts decides which backend to use.

export type StoredOpportunity = {
  id: string;
  topic: string;
  viralityScore: number;
  confidence: number;
  draft: string;
  contentAngle: string;
  imageSearchQuery: string;
  /**
   * Optional. Real image URL extracted from the source article's OpenGraph
   * tags (Galaxy.04) or BBC RSS media:thumbnail. Pre-fills the Post Now
   * modal so the user doesn't have to find an image themselves.
   */
  imageUrl?: string;
  reasoning: string;
  shouldAct: boolean;
  roiEstimate: 'high' | 'medium' | 'low';
  hashtagSuggestions: string[];
  optimalPostTime: string;
  source: 'detector' | 'manual';
  detectedAt: string; // ISO string
};

export const MAX_ITEMS = 20;        // never keep more than 20 cards
export const MAX_AGE_HOURS = 4;     // discard opportunities older than 4 hours
export const DEDUPE_WINDOW_MS = 60 * 60 * 1000; // 1 hour — skip duplicate topics

export function isFresh(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < MAX_AGE_HOURS * 60 * 60 * 1000;
}

export function isRecentDuplicate(
  opp: StoredOpportunity,
  current: StoredOpportunity[],
): boolean {
  return current.some(
    (o) =>
      o.topic === opp.topic &&
      Date.now() - new Date(o.detectedAt).getTime() < DEDUPE_WINDOW_MS,
  );
}
