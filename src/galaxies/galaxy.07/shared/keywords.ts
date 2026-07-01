const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'have', 'been', 'will',
  'says', 'after', 'over', 'into', 'about', 'their', 'what', 'when', 'where',
  'who', 'how', 'new', 'news', 'just', 'your', 'you', 'are', 'was', 'were',
]);

const GROWTH_HOOK_WORDS = new Set([
  'viral', 'debate', 'exposed', 'shocking', 'insane', 'wild', 'leaked', 'drama',
  'controversy', 'breaks', 'reacts', 'destroyed', 'cancelled', 'canceled',
  'truth', 'secret', 'hack', 'ai', 'trump', 'musk', 'crypto',
]);

export function extractEntities(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/^#/, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
}

export function entityOverlap(a: string[], b: string[]): number {
  return a.filter((x) => b.some((y) => x.includes(y) || y.includes(x) || x === y)).length;
}

export function growthHookBonus(title: string): number {
  const words = extractEntities(title);
  let bonus = 0;
  for (const w of words) {
    if (GROWTH_HOOK_WORDS.has(w)) bonus += 5;
  }
  return Math.min(bonus, 20);
}

export function slugify(text: string, max = 32): string {
  return text.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, max);
}
