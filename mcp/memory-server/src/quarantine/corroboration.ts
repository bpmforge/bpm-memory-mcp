/**
 * T11.3 — corroboration decision for promoting a quarantined fact.
 *
 * A quarantined fact promotes when a second, INDEPENDENT source reports the
 * same claim. "Independent" = a different source_url; "same claim" is
 * decided by embedding similarity (fact_store already computes this via
 * AutoLinker), not exact text match — two sources rarely phrase a claim
 * identically. Kept as a pure function so the decision is testable without
 * a live embedding model: callers gather candidates (from AutoLinker's
 * created + suggested links, enriched with each target's source_url) and
 * pass them in.
 */

export interface CorroborationCandidate {
  memoryId: string;
  similarity: number;
  sourceUrl: string | null;
}

/** An auto-created link, as returned by AutoLinker.processNewMemory. */
export interface AutoLinkCandidate {
  targetId: string;
  linkType: string;
  strength: number;
}

/** Similarity at/above which two facts are considered the same claim. */
export const CORROBORATION_SIMILARITY_THRESHOLD = 0.75;

/**
 * Turn AutoLinker's auto-created links into corroboration candidates,
 * excluding CONTRADICTS. High embedding similarity alone doesn't mean
 * agreement — two facts of opposite polarity on the same topic ("retries 3
 * times" vs "does not retry") are exactly what CONTRADICTS flags, and are
 * exactly the case a poisoning defense must never auto-promote on.
 */
export function buildCorroborationCandidates(
  links: AutoLinkCandidate[],
  sourceUrlById: Map<string, string | null>
): CorroborationCandidate[] {
  return links
    .filter((l) => l.linkType !== 'contradicts')
    .map((l) => ({
      memoryId: l.targetId,
      similarity: l.strength,
      sourceUrl: sourceUrlById.get(l.targetId) ?? null,
    }));
}

/**
 * Returns the id of the strongest independent-source match that corroborates
 * the new fact, or null if none qualifies.
 */
export function findCorroboratingMemory(
  candidates: CorroborationCandidate[],
  newSourceUrl: string,
  threshold: number = CORROBORATION_SIMILARITY_THRESHOLD
): string | null {
  const independent = candidates
    .filter(
      (c) => c.sourceUrl !== null && c.sourceUrl !== newSourceUrl && c.similarity >= threshold
    )
    .sort((a, b) => b.similarity - a.similarity);

  return independent.length > 0 ? independent[0]!.memoryId : null;
}
