import type { Memory, MemorySearchResult, Volatility } from '../types.js';

/**
 * Volatility-scaled staleness penalty (T11.2).
 *
 * Each volatility class linearly decays a memory's recall score from 1 down
 * to a class-specific floor over a class-specific window, measured from the
 * last time the memory's content was confirmed accurate. 'static' facts
 * never decay. 'volatile' facts unverified for >30 days floor at 0.
 */
interface VolatilityWindow {
  /** Days over which the multiplier decays linearly from 1 to `floor`. */
  decayDays: number;
  /** Multiplier once `decayDays` have elapsed since the last verification. */
  floor: number;
}

const VOLATILITY_WINDOWS: Record<Volatility, VolatilityWindow> = {
  static: { decayDays: Infinity, floor: 1 },
  slow: { decayDays: 180, floor: 0.5 },
  volatile: { decayDays: 30, floor: 0 },
};

/**
 * Staleness multiplier in [floor, 1] for a memory, as of `now`.
 *
 * `verifiedAt` NULL (never explicitly re-verified — see Memory.verifiedAt's
 * doc comment on why this is distinct from V9's lastVerified) falls back to
 * `createdAt`: a memory is presumed accurate as of its own creation, so an
 * unverified memory's age is measured from when it was written.
 */
export function volatilityMultiplier(
  memory: Pick<Memory, 'volatility' | 'verifiedAt' | 'createdAt'>,
  now: Date = new Date()
): number {
  const window = VOLATILITY_WINDOWS[memory.volatility ?? 'slow'];
  if (!Number.isFinite(window.decayDays)) return 1;

  const effectiveVerifiedAt = memory.verifiedAt ?? memory.createdAt;
  const ageDays = (now.getTime() - effectiveVerifiedAt.getTime()) / (1000 * 60 * 60 * 24);

  if (ageDays <= 0) return 1;
  if (ageDays >= window.decayDays) return window.floor;

  const progress = ageDays / window.decayDays;
  return 1 - progress * (1 - window.floor);
}

/**
 * Fold the volatility-scaled staleness penalty into each result's relevance
 * score and re-sort descending. Intended to run on a wider-than-final
 * candidate set so a staled-out memory can be displaced by a fresher one
 * rather than merely occupying a low-scoring slot in the final page.
 */
export function applyVolatilityStaleness(
  results: MemorySearchResult[],
  now: Date = new Date()
): MemorySearchResult[] {
  return results
    .map((r) => ({
      ...r,
      relevance: r.relevance * volatilityMultiplier(r.memory, now),
    }))
    .sort((a, b) => b.relevance - a.relevance);
}
