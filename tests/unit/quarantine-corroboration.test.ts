import { describe, it, expect } from 'vitest';
import {
  findCorroboratingMemory,
  buildCorroborationCandidates,
  CORROBORATION_SIMILARITY_THRESHOLD,
  type CorroborationCandidate,
} from '../../mcp/memory-server/src/quarantine/index.js';

describe('findCorroboratingMemory (T11.3)', () => {
  it('returns null when there are no candidates', () => {
    expect(findCorroboratingMemory([], 'https://a.example.com')).toBeNull();
  });

  it('matches a high-similarity candidate from a different source', () => {
    const candidates: CorroborationCandidate[] = [
      { memoryId: 'm1', similarity: 0.9, sourceUrl: 'https://reddit.com/r/foo/1' },
    ];
    expect(findCorroboratingMemory(candidates, 'https://reddit.com/r/bar/2')).toBe('m1');
  });

  it('does not corroborate against the same source_url (not independent)', () => {
    const sameUrl = 'https://reddit.com/r/foo/1';
    const candidates: CorroborationCandidate[] = [
      { memoryId: 'm1', similarity: 0.95, sourceUrl: sameUrl },
    ];
    expect(findCorroboratingMemory(candidates, sameUrl)).toBeNull();
  });

  it('does not corroborate below the similarity threshold', () => {
    const candidates: CorroborationCandidate[] = [
      {
        memoryId: 'm1',
        similarity: CORROBORATION_SIMILARITY_THRESHOLD - 0.01,
        sourceUrl: 'https://b.example.com',
      },
    ];
    expect(findCorroboratingMemory(candidates, 'https://a.example.com')).toBeNull();
  });

  it('accepts a candidate exactly at the threshold', () => {
    const candidates: CorroborationCandidate[] = [
      {
        memoryId: 'm1',
        similarity: CORROBORATION_SIMILARITY_THRESHOLD,
        sourceUrl: 'https://b.example.com',
      },
    ];
    expect(findCorroboratingMemory(candidates, 'https://a.example.com')).toBe('m1');
  });

  it('ignores candidates with no source_url (not a structured fact)', () => {
    const candidates: CorroborationCandidate[] = [
      { memoryId: 'm1', similarity: 0.99, sourceUrl: null },
    ];
    expect(findCorroboratingMemory(candidates, 'https://a.example.com')).toBeNull();
  });

  it('picks the strongest independent-source match when several qualify', () => {
    const candidates: CorroborationCandidate[] = [
      { memoryId: 'weak', similarity: 0.8, sourceUrl: 'https://b.example.com' },
      { memoryId: 'strong', similarity: 0.95, sourceUrl: 'https://c.example.com' },
      { memoryId: 'same-source', similarity: 0.99, sourceUrl: 'https://a.example.com' },
    ];
    expect(findCorroboratingMemory(candidates, 'https://a.example.com')).toBe('strong');
  });

  it('honors a custom threshold override', () => {
    const candidates: CorroborationCandidate[] = [
      { memoryId: 'm1', similarity: 0.5, sourceUrl: 'https://b.example.com' },
    ];
    expect(findCorroboratingMemory(candidates, 'https://a.example.com', 0.9)).toBeNull();
    expect(findCorroboratingMemory(candidates, 'https://a.example.com', 0.4)).toBe('m1');
  });
});

describe('buildCorroborationCandidates (T11.3)', () => {
  it('excludes CONTRADICTS links — high similarity does not mean agreement', () => {
    const sourceUrlById = new Map([['m1', 'https://b.example.com']]);
    const candidates = buildCorroborationCandidates(
      [{ targetId: 'm1', linkType: 'contradicts', strength: 0.95 }],
      sourceUrlById
    );
    expect(candidates).toHaveLength(0);
  });

  it('a CONTRADICTS link never reaches findCorroboratingMemory as a match', () => {
    const sourceUrlById = new Map([['m1', 'https://b.example.com']]);
    const candidates = buildCorroborationCandidates(
      [{ targetId: 'm1', linkType: 'contradicts', strength: 0.95 }],
      sourceUrlById
    );
    expect(findCorroboratingMemory(candidates, 'https://a.example.com')).toBeNull();
  });

  it('keeps RELATES_TO / SUPPORTS links from an independent source', () => {
    const sourceUrlById = new Map([
      ['m1', 'https://b.example.com'],
      ['m2', 'https://c.example.com'],
    ]);
    const candidates = buildCorroborationCandidates(
      [
        { targetId: 'm1', linkType: 'relates_to', strength: 0.8 },
        { targetId: 'm2', linkType: 'supports', strength: 0.9 },
      ],
      sourceUrlById
    );
    expect(candidates).toHaveLength(2);
    expect(findCorroboratingMemory(candidates, 'https://a.example.com')).toBe('m2');
  });
});
