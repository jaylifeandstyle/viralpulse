import type { Galaxy05Variant, Galaxy05VariantId } from './types';
import { variant0501 } from './variants/05.01-bbc-hybrid';
import { variant0502 } from './variants/05.02-trends-first';

export const DEFAULT_GALAXY_05_VARIANT: Galaxy05VariantId = '05.02';

const VARIANTS: Record<Galaxy05VariantId, Galaxy05Variant> = {
  '05.01': variant0501,
  '05.02': variant0502,
};

export function listGalaxy05Variants(): Galaxy05Variant[] {
  return Object.values(VARIANTS);
}

export function resolveGalaxy05Variant(id?: string): Galaxy05Variant {
  const fromEnv = process.env.GALAXY_05_VARIANT?.trim();
  const resolved = (id ?? fromEnv ?? DEFAULT_GALAXY_05_VARIANT) as Galaxy05VariantId;
  const variant = VARIANTS[resolved];
  if (!variant) {
    const known = Object.keys(VARIANTS).join(', ');
    throw new Error(`Unknown Galaxy.05 variant "${resolved}". Valid: ${known}`);
  }
  return variant;
}
