import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { EmbeddingConfig } from '../types.js';
import { getProvider, checkProviderStatus } from './discovery.js';
import { OllamaProvider } from './ollama.js';
import { LMStudioProvider } from './lmstudio.js';
import { validateModel, findBestModel } from './validation.js';

const CONFIG_DIR = join(homedir(), '.claude-memory');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export interface FullConfig {
  embedding: EmbeddingConfig;
  version: number;
  lastUpdated: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: 'ollama' | 'lmstudio';
  dimensions: number | null;
  isActive: boolean;
  isValidated: boolean;
}

export interface ModelChangeWarning {
  currentModel: string;
  newModel: string;
  memoriesCount: number;
  requiresReembedding: boolean;
  estimatedTime: string;
}

const DEFAULT_CONFIG: FullConfig = {
  embedding: {
    provider: 'ollama',
    endpoint: 'http://localhost:11434',
    model: 'nomic-embed-text',
    dimensions: 768,
  },
  version: 1,
  lastUpdated: new Date().toISOString(),
};

/**
 * Load configuration from disk
 */
export function loadConfig(): FullConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      const content = readFileSync(CONFIG_FILE, 'utf-8');
      return JSON.parse(content) as FullConfig;
    }
  } catch {
    // Fall through to default
  }
  return { ...DEFAULT_CONFIG };
}

/**
 * Save configuration to disk
 */
export function saveConfig(config: FullConfig): void {
  // Ensure directory exists
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  config.lastUpdated = new Date().toISOString();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * List all available models from detected providers
 */
export async function listAvailableModels(): Promise<ModelInfo[]> {
  const status = await checkProviderStatus();
  const currentConfig = loadConfig();
  const models: ModelInfo[] = [];

  // Get Ollama models
  if (status.ollama) {
    const ollama = new OllamaProvider();
    const ollamaModels = await ollama.listModels();
    for (const model of ollamaModels) {
      models.push({
        id: model.id,
        name: model.name,
        provider: 'ollama',
        dimensions: model.dimensions ?? null,
        isActive:
          currentConfig.embedding.provider === 'ollama' &&
          currentConfig.embedding.model === model.id,
        isValidated: false,
      });
    }
  }

  // Get LM Studio models
  if (status.lmstudio) {
    const lmstudio = new LMStudioProvider();
    const lmstudioModels = await lmstudio.listModels();
    for (const model of lmstudioModels) {
      models.push({
        id: model.id,
        name: model.name,
        provider: 'lmstudio',
        dimensions: model.dimensions ?? null,
        isActive:
          currentConfig.embedding.provider === 'lmstudio' &&
          currentConfig.embedding.model === model.id,
        isValidated: false,
      });
    }
  }

  return models;
}

/**
 * Select and validate a model
 */
export async function selectModel(
  provider: 'ollama' | 'lmstudio',
  modelId: string
): Promise<{
  success: boolean;
  config: EmbeddingConfig | null;
  error: string | null;
  warning: ModelChangeWarning | null;
}> {
  // Get provider instance
  const providerInstance = getProvider(provider);
  if (!providerInstance) {
    return {
      success: false,
      config: null,
      error: `Provider ${provider} is not available`,
      warning: null,
    };
  }

  // Validate the model
  const validation = await validateModel(providerInstance, modelId);
  if (!validation.valid) {
    return {
      success: false,
      config: null,
      error: validation.error ?? 'Model validation failed',
      warning: null,
    };
  }

  // Check for model change warning
  const currentConfig = loadConfig();
  let warning: ModelChangeWarning | null = null;

  if (
    currentConfig.embedding.model !== modelId ||
    currentConfig.embedding.provider !== provider
  ) {
    // Check if dimensions changed (requires re-embedding)
    const dimensionsChanged =
      validation.dimensions !== null &&
      currentConfig.embedding.dimensions !== validation.dimensions;

    if (dimensionsChanged) {
      warning = {
        currentModel: `${currentConfig.embedding.provider}/${currentConfig.embedding.model}`,
        newModel: `${provider}/${modelId}`,
        memoriesCount: 0, // Would need to query DB for actual count
        requiresReembedding: true,
        estimatedTime: 'Depends on memory count',
      };
    }
  }

  // Update configuration
  const newConfig: FullConfig = {
    ...currentConfig,
    embedding: {
      provider,
      endpoint:
        provider === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234',
      model: modelId,
      dimensions: validation.dimensions ?? 768,
    },
  };

  saveConfig(newConfig);

  return {
    success: true,
    config: newConfig.embedding,
    error: null,
    warning,
  };
}

/**
 * Auto-configure with best available model
 */
export async function autoConfigureModel(): Promise<{
  success: boolean;
  config: EmbeddingConfig | null;
  message: string;
}> {
  const status = await checkProviderStatus();

  // Try Ollama first
  if (status.ollama) {
    const provider = new OllamaProvider();
    const best = await findBestModel(provider);
    if (best) {
      const result = await selectModel('ollama', best.model.id);
      if (result.success) {
        return {
          success: true,
          config: result.config,
          message: `Auto-configured: Ollama/${best.model.id} (${best.validation.dimensions} dimensions)`,
        };
      }
    }
  }

  // Try LM Studio
  if (status.lmstudio) {
    const provider = new LMStudioProvider();
    const best = await findBestModel(provider);
    if (best) {
      const result = await selectModel('lmstudio', best.model.id);
      if (result.success) {
        return {
          success: true,
          config: result.config,
          message: `Auto-configured: LM Studio/${best.model.id} (${best.validation.dimensions} dimensions)`,
        };
      }
    }
  }

  return {
    success: false,
    config: null,
    message: 'No embedding models available. Please install an embedding model.',
  };
}

/**
 * Get current embedding configuration status
 */
export async function getConfigStatus(): Promise<{
  configured: boolean;
  config: EmbeddingConfig;
  providerHealthy: boolean;
  modelValid: boolean;
  message: string;
}> {
  const config = loadConfig();
  const provider = getProvider(config.embedding.provider);

  if (!provider) {
    return {
      configured: false,
      config: config.embedding,
      providerHealthy: false,
      modelValid: false,
      message: `Provider ${config.embedding.provider} not available`,
    };
  }

  const isHealthy = await provider.health();
  if (!isHealthy) {
    return {
      configured: true,
      config: config.embedding,
      providerHealthy: false,
      modelValid: false,
      message: `Provider ${config.embedding.provider} is not responding`,
    };
  }

  const validation = await validateModel(provider, config.embedding.model);

  return {
    configured: true,
    config: config.embedding,
    providerHealthy: true,
    modelValid: validation.valid,
    message: validation.valid
      ? `Ready: ${config.embedding.provider}/${config.embedding.model}`
      : validation.error ?? 'Model validation failed',
  };
}
