import type { StoredOpportunity } from '@/store/opportunity-store';
import { extractEntities, entityOverlap } from './keywords';

export function isTopicAlreadyCovered(topic: string, existing: StoredOpportunity[]): boolean {
  const entities = extractEntities(topic);
  return existing.some((o) => {
    const other = extractEntities(o.topic);
    if (entities.length === 0 || other.length === 0) return false;
    const minLen = Math.min(entities.length, other.length);
    return entityOverlap(entities, other) >= Math.max(2, Math.ceil(minLen * 0.5));
  });
}
