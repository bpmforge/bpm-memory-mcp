import type { EmbeddingProvider, EmbeddingModel } from './types.js';

export interface ValidationResult {
  valid: boolean;
  provider: string;
  model: string;
  dimensions: number | null;
  latencyMs: number | null;
  error: string | null;
  suggestions: string[];
}

const TEST_TEXT = 'This is a test sentence for embedding validation.';

/**
 * Validate an embedding model by generating a test embedding
 */
export async function validateModel(
  provider: EmbeddingProvider,
  modelId: string
): Promise<ValidationResult> {
  const startTime = Date.now();
  const suggestions: string[] = [];

  try {
    // Check provider health first
    const isHealthy = await provider.health();
    if (!isHealthy) {
      return {
        valid: false,
        provider: provider.name,
        model: modelId,
        dimensions: null,
        latencyMs: null,
        error: `Provider ${provider.name} is not responding`,
        suggestions: [
          `Ensure ${provider.name} is running`,
          `Check the endpoint: ${provider.endpoint}`,
        ],
      };
    }

    // Check if model exists
    const models = await provider.listModels();
    const modelExists = models.some((m) => m.id === modelId || m.name === modelId);

    if (!modelExists) {
      const embeddingModels = models.filter((m) => isEmbeddingModel(m));
      return {
        valid: false,
        provider: provider.name,
        model: modelId,
        dimensions: null,
        latencyMs: null,
        error: `Model '${modelId}' not found`,
        suggestions: [
          `Available embedding models: ${embeddingModels.map((m) => m.id).join(', ') || 'none'}`,
          `Try pulling the model: ollama pull ${modelId}`,
        ],
      };
    }

    // Generate test embedding
    const embedding = await provider.embed(TEST_TEXT, modelId);
    const latencyMs = Date.now() - startTime;

    // Validate embedding
    if (!embedding || embedding.length === 0) {
      return {
        valid: false,
        provider: provider.name,
        model: modelId,
        dimensions: null,
        latencyMs,
        error: 'Model returned empty embedding',
        suggestions: [
          'This model may not support embeddings',
          'Try a dedicated embedding model like nomic-embed-text',
        ],
      };
    }

    // Check for valid values (not all zeros or NaN)
    const hasValidValues = Array.from(embedding).some((v) => !isNaN(v) && v !== 0);
    if (!hasValidValues) {
      return {
        valid: false,
        provider: provider.name,
        model: modelId,
        dimensions: embedding.length,
        latencyMs,
        error: 'Model returned invalid embedding (all zeros or NaN)',
        suggestions: ['Try a different embedding model'],
      };
    }

    // Add performance suggestions
    if (latencyMs > 500) {
      suggestions.push(`Embedding latency is high (${latencyMs}ms). Consider a smaller model.`);
    }

    if (embedding.length < 256) {
      suggestions.push(
        `Low dimension model (${embedding.length}). May have reduced semantic accuracy.`
      );
    }

    if (embedding.length > 2048) {
      suggestions.push(
        `High dimension model (${embedding.length}). Good accuracy but higher storage cost.`
      );
    }

    return {
      valid: true,
      provider: provider.name,
      model: modelId,
      dimensions: embedding.length,
      latencyMs,
      error: null,
      suggestions,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      valid: false,
      provider: provider.name,
      model: modelId,
      dimensions: null,
      latencyMs: Date.now() - startTime,
      error: message,
      suggestions: [
        'Check if the model supports the embeddings API',
        'Verify the model is fully downloaded',
      ],
    };
  }
}

/**
 * Validate multiple models and return results
 */
export async function validateModels(
  provider: EmbeddingProvider,
  modelIds: string[]
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];

  for (const modelId of modelIds) {
    const result = await validateModel(provider, modelId);
    results.push(result);
  }

  return results;
}

/**
 * Find the best available embedding model
 */
export async function findBestModel(
  provider: EmbeddingProvider
): Promise<{ model: EmbeddingModel; validation: ValidationResult } | null> {
  const models = await provider.listModels();
  const embeddingModels = models.filter(isEmbeddingModel);

  // Sort by preference (nomic-embed-text > mxbai > bge > other)
  const priorityOrder = ['nomic-embed-text', 'mxbai-embed', 'bge-', 'all-minilm'];
  embeddingModels.sort((a, b) => {
    const aIndex = priorityOrder.findIndex((p) => a.id.includes(p));
    const bIndex = priorityOrder.findIndex((p) => b.id.includes(p));
    return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
  });

  for (const model of embeddingModels) {
    const validation = await validateModel(provider, model.id);
    if (validation.valid) {
      return { model, validation };
    }
  }

  return null;
}

/**
 * Check if a model is likely an embedding model based on name
 */
function isEmbeddingModel(model: EmbeddingModel): boolean {
  const name = model.id.toLowerCase();
  const embeddingKeywords = ['embed', 'bge', 'e5', 'minilm', 'gte', 'sentence'];
  return embeddingKeywords.some((kw) => name.includes(kw));
}
