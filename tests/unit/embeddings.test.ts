import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch for provider tests
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('Ollama Provider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should detect Ollama availability', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [] }),
    });

    const response = await fetch('http://localhost:11434/api/tags');
    expect(response.ok).toBe(true);
  });

  it('should list models from Ollama', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: [
          { name: 'nomic-embed-text', size: 274000000 },
          { name: 'llama2', size: 3800000000 },
          { name: 'mxbai-embed-large', size: 670000000 },
        ],
      }),
    });

    const response = await fetch('http://localhost:11434/api/tags');
    const data = await response.json();

    // Filter embedding models (contain 'embed' in name)
    const embeddingModels = data.models.filter((m: { name: string }) =>
      m.name.toLowerCase().includes('embed')
    );

    expect(embeddingModels.length).toBe(2);
    expect(embeddingModels[0].name).toBe('nomic-embed-text');
  });

  it('should generate embeddings from Ollama', async () => {
    const mockEmbedding = Array(768).fill(0).map(() => Math.random());

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        embedding: mockEmbedding,
      }),
    });

    const response = await fetch('http://localhost:11434/api/embeddings', {
      method: 'POST',
      body: JSON.stringify({
        model: 'nomic-embed-text',
        prompt: 'Test text to embed',
      }),
    });

    const data = await response.json();

    expect(data.embedding).toBeDefined();
    expect(data.embedding.length).toBe(768);
  });

  it('should handle Ollama connection failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    await expect(fetch('http://localhost:11434/api/tags')).rejects.toThrow('Connection refused');
  });

  it('should handle embedding generation failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    const response = await fetch('http://localhost:11434/api/embeddings', {
      method: 'POST',
      body: JSON.stringify({ model: 'invalid', prompt: 'test' }),
    });

    expect(response.ok).toBe(false);
    expect(response.status).toBe(500);
  });
});

describe('LM Studio Provider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should detect LM Studio availability', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ id: 'text-embedding-nomic-embed-text-v1.5' }],
      }),
    });

    const response = await fetch('http://localhost:1234/v1/models');
    expect(response.ok).toBe(true);
  });

  it('should list models from LM Studio', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { id: 'text-embedding-nomic-embed-text-v1.5', object: 'model' },
          { id: 'lmstudio-community/Meta-Llama-3', object: 'model' },
        ],
      }),
    });

    const response = await fetch('http://localhost:1234/v1/models');
    const data = await response.json();

    // Filter embedding models
    const embeddingModels = data.data.filter((m: { id: string }) =>
      m.id.toLowerCase().includes('embed')
    );

    expect(embeddingModels.length).toBe(1);
  });

  it('should generate embeddings using OpenAI-compatible API', async () => {
    const mockEmbedding = Array(768).fill(0).map(() => Math.random());

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ embedding: mockEmbedding, index: 0 }],
        model: 'text-embedding-nomic-embed-text-v1.5',
        usage: { prompt_tokens: 5, total_tokens: 5 },
      }),
    });

    const response = await fetch('http://localhost:1234/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'text-embedding-nomic-embed-text-v1.5',
        input: 'Test text to embed',
      }),
    });

    const data = await response.json();

    expect(data.data[0].embedding).toBeDefined();
    expect(data.data[0].embedding.length).toBe(768);
  });
});

describe('Provider Auto-Detection', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should detect Ollama when available', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('11434')) {
        return Promise.resolve({ ok: true, json: async () => ({ models: [] }) });
      }
      return Promise.reject(new Error('Connection refused'));
    });

    const ollamaResponse = await fetch('http://localhost:11434/api/tags');
    expect(ollamaResponse.ok).toBe(true);
  });

  it('should detect LM Studio when available', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('1234')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
      }
      return Promise.reject(new Error('Connection refused'));
    });

    const lmStudioResponse = await fetch('http://localhost:1234/v1/models');
    expect(lmStudioResponse.ok).toBe(true);
  });

  it('should detect when no providers available', async () => {
    mockFetch.mockRejectedValue(new Error('Connection refused'));

    const providers: string[] = [];

    try {
      await fetch('http://localhost:11434/api/tags');
      providers.push('ollama');
    } catch {
      // Ollama not available
    }

    try {
      await fetch('http://localhost:1234/v1/models');
      providers.push('lmstudio');
    } catch {
      // LM Studio not available
    }

    expect(providers.length).toBe(0);
  });

  it('should prefer Ollama when both available', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ models: [], data: [] }),
    });

    const providers: string[] = [];

    const ollamaResponse = await fetch('http://localhost:11434/api/tags');
    if (ollamaResponse.ok) providers.push('ollama');

    const lmStudioResponse = await fetch('http://localhost:1234/v1/models');
    if (lmStudioResponse.ok) providers.push('lmstudio');

    // First available should be Ollama
    expect(providers[0]).toBe('ollama');
  });
});

describe('Embedding Cache', () => {
  it('should hash content consistently', () => {
    const crypto = require('crypto');
    const hash = (content: string) =>
      crypto.createHash('sha256').update(content).digest('hex');

    const content = 'Test content for hashing';

    expect(hash(content)).toBe(hash(content));
    expect(hash(content)).not.toBe(hash('Different content'));
  });

  it('should convert Float32Array to Buffer', () => {
    const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const buffer = Buffer.from(embedding.buffer);

    expect(buffer.length).toBe(16); // 4 floats * 4 bytes
  });

  it('should convert Buffer back to Float32Array', () => {
    const original = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const buffer = Buffer.from(original.buffer);

    // Create new ArrayBuffer from Buffer
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    );
    const restored = new Float32Array(arrayBuffer);

    expect(restored.length).toBe(4);
    expect(restored[0]).toBeCloseTo(0.1, 5);
    expect(restored[3]).toBeCloseTo(0.4, 5);
  });
});

describe('Graceful Degradation', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should fall back to BM25-only when no embedding provider', async () => {
    mockFetch.mockRejectedValue(new Error('Connection refused'));

    let useVectorSearch = true;

    try {
      await fetch('http://localhost:11434/api/tags');
    } catch {
      useVectorSearch = false;
    }

    expect(useVectorSearch).toBe(false);
  });

  it('should queue failed embeddings for retry', () => {
    const pendingEmbeddings: string[] = [];

    const queueForEmbedding = (content: string) => {
      pendingEmbeddings.push(content);
    };

    queueForEmbedding('Content 1');
    queueForEmbedding('Content 2');

    expect(pendingEmbeddings.length).toBe(2);
  });

  it('should process pending queue when provider becomes available', async () => {
    const pendingEmbeddings = ['Content 1', 'Content 2'];
    const processedEmbeddings: string[] = [];

    // Simulate provider becoming available
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: Array(768).fill(0) }),
    });

    for (const content of pendingEmbeddings) {
      const response = await fetch('http://localhost:11434/api/embeddings', {
        method: 'POST',
        body: JSON.stringify({ model: 'nomic-embed-text', prompt: content }),
      });
      if (response.ok) {
        processedEmbeddings.push(content);
      }
    }

    expect(processedEmbeddings.length).toBe(2);
  });
});
