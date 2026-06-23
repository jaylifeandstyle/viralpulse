// src/shared/types.ts

export type GrowthMode = 'pure_growth' | 'niche_loyal';

export type UserPreferences = {
  userId: string;
  mode: GrowthMode;
  aggressiveness: number;           // 1 to 10
  weeklyFollowerTarget: number;
  niches?: string[];
  exclusions?: string[];
  toneExamples?: string;
};

export type OpportunitySignals = {
  topic: string;
  velocity: number;                 // posts per hour
  acceleration: number;             // how fast it's growing
  avgEngagement: number;
  trending: boolean;
  samplePosts: any[];
  timestamp: Date;
};

export type GalaxyOutput = {
  galaxyId: string;
  viralityScore: number;
  confidence: number;
  shouldAct: boolean;
  contentAngle: string;
  draftTweet: string;
  imageSearchQuery: string;
  reasoning: string;
  optimalPostTime: string;
  hashtagSuggestions: string[];
  roiEstimate: 'high' | 'medium' | 'low';
  suggestedAction: 'post_now' | 'schedule' | 'monitor' | 'ignore';
};