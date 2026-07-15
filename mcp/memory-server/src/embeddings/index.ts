import { detectProviders, getProvider, checkProviderStatus, listAllModels } from './discovery.js';
import { EmbeddingCache } from './cache.js';
import type { EmbeddingProvider, EmbeddingModel, ProviderConfig } from './types.js';
import type { DatabaseConnection } from '../storage/database.js';

export * from './types.js';
export { OllamaProvider, createOllamaProvider } from './ollama.js';
export { LMStudioProvider, createLMStudioProvider } from './lmstudio.js';
export { detectProviders, getProvider, checkProviderStatus, listAllModels } from './discovery.js';
export { EmbeddingCache } from './cache.js';
export { validateModel, validateModels, findBestModel } from './validation.js';
export {
  loadConfig,
  saveConfig,
  listAvailableModels,
  selectModel,
  autoConfigureModel,
  getConfigStatus,
} from './config.js';

/**
 * Embedding service with provider management and caching
 */
export class EmbeddingService {
  private provider: EmbeddingProvider | null = null;
  private model: string | null = null;
  private cache: EmbeddingCache;
  private initialized = false;
  /** The config the last initialize() ran with, so ensureReady() can retry it. */
  private lastConfig: ProviderConfig | undefined = undefined;
  /** Timestamp (ms) of the last initialize() attempt, for re-init throttling. */
  private lastInitAttempt = 0;
  /**
   * Minimum gap between automatic re-init attempts once the provider was found
   * unavailable. Public so tests can shorten it. A down provider is retried at
   * most once per window, so recall stays fast when it's genuinely offline.
   */
  reinitThrottleMs = 30_000;

  constructor(db?: DatabaseConnection) {
    this.cache = new EmbeddingCache(db);
  }

  /**
   * Initialize with auto-detection or explicit config
   */
  async initialize(config?: ProviderConfig): Promise<boolean> {
    this.lastConfig = config;
    this.lastInitAttempt = Date.now();

    if (config) {
      // Use explicit configuration
      this.provider = getProvider(config.provider, config.endpoint);
      this.model = config.model;

      const healthy = await this.provider.health();
      this.initialized = healthy;
      return healthy;
    }

    // Auto-detect provider
    const result = await detectProviders();
    if (result.provider && result.selectedModel) {
      this.provider = result.provider;
      this.model = result.selectedModel.id;
      this.initialized = true;
      return true;
    }

    this.initialized = false;
    return false;
  }

  /**
   * Lazily (re)initialize the embedder if it is not ready.
   *
   * A provider that is unreachable at server startup (e.g. LM Studio still
   * loading a model) must NOT disable semantic recall for the entire session:
   * before this, initialize() ran exactly once and any failure left every
   * subsequent recall on keyword-only search — even though the vector corpus is
   * fully embedded. ensureReady() retries the last-used config, throttled, so a
   * transient startup outage self-heals on the next embed() instead of degrading
   * silently forever. Returns true if the service is ready afterwards.
   */
  async ensureReady(): Promise<boolean> {
    if (this.isAvailable) return true;
    const now = Date.now();
    if (now - this.lastInitAttempt < this.reinitThrottleMs) return false;
    return this.initialize(this.lastConfig);
  }

  /**
   * Check if service is available
   */
  get isAvailable(): boolean {
    return this.initialized && this.provider !== null && this.model !== null;
  }

  /**
   * Get current provider name
   */
  get providerName(): string | null {
    return this.provider?.name ?? null;
  }

  /**
   * Get current model
   */
  get currentModel(): string | null {
    return this.model;
  }

  /**
   * Generate embedding for text
   * Returns null if service unavailable (graceful degradation)
   */
  async embed(text: string): Promise<Float32Array | null> {
    // Lazy re-init: a provider unreachable at startup must not disable semantic
    // recall for the whole session — retry (throttled) before giving up.
    if (!this.isAvailable && !(await this.ensureReady())) {
      return null;
    }
    if (!this.provider || !this.model) {
      return null;
    }

    // Check cache first
    const cached = this.cache.get(text);
    if (cached) {
      return cached;
    }

    try {
      const embedding = await this.provider.embed(text, this.model);
      this.cache.set(text, embedding);
      return embedding;
    } catch (error) {
      console.error('Embedding generation failed:', error);
      return null;
    }
  }

  /**
   * Generate embeddings for multiple texts
   */
  async embedBatch(texts: string[]): Promise<Array<Float32Array | null>> {
    // Lazy re-init (see embed()) — one throttled retry before falling back.
    if (!this.isAvailable && !(await this.ensureReady())) {
      return texts.map(() => null);
    }
    if (!this.provider || !this.model) {
      return texts.map(() => null);
    }

    const results: Array<Float32Array | null> = [];
    const uncachedTexts: Array<{ index: number; text: string }> = [];

    // Check cache for each text
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i]!;
      const cached = this.cache.get(text);
      if (cached) {
        results[i] = cached;
      } else {
        results[i] = null;
        uncachedTexts.push({ index: i, text });
      }
    }

    // Embed uncached texts
    if (uncachedTexts.length > 0) {
      try {
        const embeddings = this.provider.embedBatch
          ? await this.provider.embedBatch(
              uncachedTexts.map((t) => t.text),
              this.model
            )
          : await Promise.all(uncachedTexts.map((t) => this.provider!.embed(t.text, this.model!)));

        for (let i = 0; i < uncachedTexts.length; i++) {
          const item = uncachedTexts[i]!;
          const embedding = embeddings[i]!;
          results[item.index] = embedding;
          this.cache.set(item.text, embedding);
        }
      } catch (error) {
        console.error('Batch embedding failed:', error);
      }
    }

    return results;
  }

  /**
   * List available models
   */
  async listModels(): Promise<EmbeddingModel[]> {
    if (!this.provider) {
      return [];
    }
    return this.provider.listModels();
  }

  /**
   * Switch to a different model
   */
  async switchModel(modelId: string): Promise<boolean> {
    if (!this.provider) {
      return false;
    }

    const models = await this.provider.listModels();
    const model = models.find((m) => m.id === modelId);

    if (!model) {
      return false;
    }

    this.model = modelId;
    this.cache.clearMemory(); // Clear cache on model switch
    return true;
  }

  /**
   * Get embedding dimensions by generating a test embedding
   */
  async getDimensions(): Promise<number | null> {
    if (!this.isAvailable) {
      return null;
    }

    const testEmbedding = await this.embed('test');
    return testEmbedding?.length ?? null;
  }

  /**
   * Get service status
   */
  async getStatus(): Promise<{
    available: boolean;
    provider: string | null;
    model: string | null;
    cacheStats: { memoryEntries: number; hitRate: number };
  }> {
    return {
      available: this.isAvailable,
      provider: this.providerName,
      model: this.model,
      cacheStats: this.cache.stats(),
    };
  }
}
