import { OllamaProvider } from './ollama.js';
import { LMStudioProvider } from './lmstudio.js';
import type { EmbeddingProvider, EmbeddingModel, DetectionResult } from './types.js';

/**
 * Auto-detect available embedding providers
 * Checks Ollama first, then LM Studio
 */
export async function detectProviders(): Promise<DetectionResult> {
  // Try Ollama first
  const ollama = new OllamaProvider();
  if (await ollama.health()) {
    const models = await ollama.listModels();
    const embeddingModels = models.filter(isEmbeddingModel);

    if (embeddingModels.length > 0) {
      return {
        provider: ollama,
        models: embeddingModels,
        selectedModel: embeddingModels[0] ?? null,
      };
    }
  }

  // Try LM Studio
  const lmstudio = new LMStudioProvider();
  if (await lmstudio.health()) {
    const models = await lmstudio.listModels();
    const embeddingModels = models.filter(isEmbeddingModel);

    if (embeddingModels.length > 0) {
      return {
        provider: lmstudio,
        models: embeddingModels,
        selectedModel: embeddingModels[0] ?? null,
      };
    }
  }

  // No provider available
  return {
    provider: null,
    models: [],
    selectedModel: null,
  };
}

/**
 * Get provider by name
 */
export function getProvider(
  name: 'ollama' | 'lmstudio',
  endpoint?: string
): EmbeddingProvider {
  switch (name) {
    case 'ollama':
      return new OllamaProvider(endpoint);
    case 'lmstudio':
      return new LMStudioProvider(endpoint);
  }
}

/**
 * Check if a model is embedding-capable based on name
 */
function isEmbeddingModel(model: EmbeddingModel): boolean {
  const name = model.name.toLowerCase();
  return name.includes('embed') || name.includes('embedding');
}

/**
 * List all available models from all providers
 */
export async function listAllModels(): Promise<{
  ollama: EmbeddingModel[];
  lmstudio: EmbeddingModel[];
}> {
  const [ollamaModels, lmstudioModels] = await Promise.all([
    new OllamaProvider().listModels().catch(() => []),
    new LMStudioProvider().listModels().catch(() => []),
  ]);

  return {
    ollama: ollamaModels,
    lmstudio: lmstudioModels,
  };
}

/**
 * Check status of all providers
 */
export async function checkProviderStatus(): Promise<{
  ollama: boolean;
  lmstudio: boolean;
}> {
  const [ollamaHealth, lmstudioHealth] = await Promise.all([
    new OllamaProvider().health(),
    new LMStudioProvider().health(),
  ]);

  return {
    ollama: ollamaHealth,
    lmstudio: lmstudioHealth,
  };
}
