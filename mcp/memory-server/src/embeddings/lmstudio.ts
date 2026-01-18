import type {
  EmbeddingProvider,
  EmbeddingModel,
  OpenAIModelsResponse,
  OpenAIEmbedResponse,
} from './types.js';

const DEFAULT_ENDPOINT = 'http://localhost:1234';
const TIMEOUT_MS = 5000;

/**
 * LM Studio embedding provider
 * Uses OpenAI-compatible API format
 */
export class LMStudioProvider implements EmbeddingProvider {
  readonly name = 'lmstudio';
  readonly endpoint: string;

  constructor(endpoint: string = DEFAULT_ENDPOINT) {
    this.endpoint = endpoint.replace(/\/$/, ''); // Remove trailing slash
  }

  async health(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch(`${this.endpoint}/v1/models`, {
        signal: controller.signal,
      });

      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<EmbeddingModel[]> {
    try {
      const response = await fetch(`${this.endpoint}/v1/models`);
      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as OpenAIModelsResponse;

      // Filter to embedding-capable models (id contains 'embed')
      return data.data
        .filter((m) => m.id.toLowerCase().includes('embed'))
        .map((m) => ({
          id: m.id,
          name: m.id,
          provider: 'lmstudio' as const,
        }));
    } catch {
      return [];
    }
  }

  async embed(text: string, model: string): Promise<Float32Array> {
    const response = await fetch(`${this.endpoint}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: text }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LM Studio embedding failed: ${error}`);
    }

    const data = (await response.json()) as OpenAIEmbedResponse;

    if (!data.data?.[0]?.embedding) {
      throw new Error('LM Studio returned no embedding data');
    }

    return new Float32Array(data.data[0].embedding);
  }

  async embedBatch(texts: string[], model: string): Promise<Float32Array[]> {
    // LM Studio supports batch via array input
    const response = await fetch(`${this.endpoint}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: texts }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LM Studio batch embedding failed: ${error}`);
    }

    const data = (await response.json()) as OpenAIEmbedResponse;

    // Sort by index and extract embeddings
    return data.data
      .sort((a, b) => a.index - b.index)
      .map((d) => new Float32Array(d.embedding));
  }
}

/**
 * Create LM Studio provider with default or custom endpoint
 */
export function createLMStudioProvider(endpoint?: string): LMStudioProvider {
  return new LMStudioProvider(endpoint);
}
