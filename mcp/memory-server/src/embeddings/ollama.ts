import type {
  EmbeddingProvider,
  EmbeddingModel,
  OllamaTagsResponse,
  OllamaEmbedResponse,
} from './types.js';

const DEFAULT_ENDPOINT = 'http://localhost:11434';
const TIMEOUT_MS = 5000;

/**
 * Ollama embedding provider
 * Uses native Ollama API format
 */
export class OllamaProvider implements EmbeddingProvider {
  readonly name = 'ollama';
  readonly endpoint: string;

  constructor(endpoint: string = DEFAULT_ENDPOINT) {
    this.endpoint = endpoint.replace(/\/$/, ''); // Remove trailing slash
  }

  async health(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch(`${this.endpoint}/api/tags`, {
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
      const response = await fetch(`${this.endpoint}/api/tags`);
      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as OllamaTagsResponse;

      // Filter to embedding-capable models (name contains 'embed')
      return data.models
        .filter((m) => m.name.toLowerCase().includes('embed'))
        .map((m) => ({
          id: m.name,
          name: m.name,
          provider: 'ollama' as const,
        }));
    } catch {
      return [];
    }
  }

  async embed(text: string, model: string): Promise<Float32Array> {
    const response = await fetch(`${this.endpoint}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: text }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama embedding failed: ${error}`);
    }

    const data = (await response.json()) as OllamaEmbedResponse;
    return new Float32Array(data.embedding);
  }

  async embedBatch(texts: string[], model: string): Promise<Float32Array[]> {
    // Ollama doesn't support batch natively, process sequentially
    const results: Float32Array[] = [];
    for (const text of texts) {
      results.push(await this.embed(text, model));
    }
    return results;
  }
}

/**
 * Create Ollama provider with default or custom endpoint
 */
export function createOllamaProvider(endpoint?: string): OllamaProvider {
  return new OllamaProvider(endpoint);
}
