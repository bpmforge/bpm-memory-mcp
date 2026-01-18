/**
 * Embedding provider interface and types
 */

export interface EmbeddingProvider {
  readonly name: string;
  readonly endpoint: string;

  /**
   * Check if the provider is available
   */
  health(): Promise<boolean>;

  /**
   * List available embedding models
   */
  listModels(): Promise<EmbeddingModel[]>;

  /**
   * Generate embedding for text
   */
  embed(text: string, model: string): Promise<Float32Array>;

  /**
   * Generate embeddings for multiple texts (batch)
   */
  embedBatch?(texts: string[], model: string): Promise<Float32Array[]>;
}

export interface EmbeddingModel {
  id: string;
  name: string;
  dimensions?: number;
  provider: 'ollama' | 'lmstudio';
}

export interface ProviderConfig {
  provider: 'ollama' | 'lmstudio';
  endpoint: string;
  model: string;
  dimensions: number;
}

export interface DetectionResult {
  provider: EmbeddingProvider | null;
  models: EmbeddingModel[];
  selectedModel: EmbeddingModel | null;
}

/**
 * Ollama API types
 */
export interface OllamaTagsResponse {
  models: Array<{
    name: string;
    size: number;
    digest: string;
    modified_at: string;
  }>;
}

export interface OllamaEmbedResponse {
  embedding: number[];
}

/**
 * OpenAI-compatible API types (LM Studio)
 */
export interface OpenAIModelsResponse {
  data: Array<{
    id: string;
    object: string;
    owned_by: string;
  }>;
  object: string;
}

export interface OpenAIEmbedRequest {
  model: string;
  input: string | string[];
}

export interface OpenAIEmbedResponse {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}
