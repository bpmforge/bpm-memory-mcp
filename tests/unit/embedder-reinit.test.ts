import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmbeddingService } from '../../mcp/memory-server/src/embeddings/index.js';
import type { ProviderConfig } from '../../mcp/memory-server/src/embeddings/types.js';

/**
 * Regression test for the embedder self-heal bug: initialize() ran exactly once
 * per project, so a provider unreachable at server startup (LM Studio still
 * loading) left semantic recall on keyword-only search for the ENTIRE session,
 * even though the vector corpus was fully embedded. ensureReady() must retry the
 * last config (throttled) so a transient startup outage self-heals on the next
 * embed().
 */

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const CONFIG: ProviderConfig = {
  provider: 'lmstudio',
  endpoint: 'http://localhost:1234',
  model: 'text-embedding-nomic-embed-text-v1.5',
};

// Route LM Studio's two endpoints; `healthy` toggles /v1/models availability.
function route(healthy: boolean) {
  mockFetch.mockImplementation(async (url: string) => {
    if (url.endsWith('/v1/models')) {
      return {
        ok: healthy,
        json: async () => ({ data: [{ id: 'text-embedding-nomic-embed-text-v1.5' }] }),
      };
    }
    if (url.endsWith('/v1/embeddings')) {
      return { ok: true, json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }) };
    }
    return { ok: false, json: async () => ({}) };
  });
}

describe('EmbeddingService lazy re-init (embedder self-heal)', () => {
  beforeEach(() => mockFetch.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('self-heals: embed() re-inits once the provider that was down at startup comes up', async () => {
    const svc = new EmbeddingService();
    svc.reinitThrottleMs = 0; // allow an immediate retry in the test

    // Provider unreachable at startup → init fails, service degraded.
    route(false);
    expect(await svc.initialize(CONFIG)).toBe(false);
    expect(svc.isAvailable).toBe(false);

    // Provider comes up; the very next embed() should re-init and return a vector.
    route(true);
    const vec = await svc.embed('jira adapter source of truth');
    expect(vec).not.toBeNull();
    expect(svc.isAvailable).toBe(true);
    expect(vec!.length).toBe(3);
    expect(vec![0]).toBeCloseTo(0.1);
  });

  it('throttles: a still-down provider is NOT re-probed within the window (recall stays fast)', async () => {
    const svc = new EmbeddingService();
    svc.reinitThrottleMs = 60_000; // wide window
    route(false);
    await svc.initialize(CONFIG); // one health probe
    mockFetch.mockClear();

    const vec = await svc.embed('still down');
    expect(vec).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled(); // throttled — no re-probe
  });

  it('no-op when already available: ensureReady() does not re-probe a healthy provider', async () => {
    const svc = new EmbeddingService();
    route(true);
    await svc.initialize(CONFIG);
    expect(svc.isAvailable).toBe(true);
    mockFetch.mockClear();

    expect(await svc.ensureReady()).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
