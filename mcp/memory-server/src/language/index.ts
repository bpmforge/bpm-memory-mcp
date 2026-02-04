/**
 * Language detection and code context module
 */

export {
  detectLanguage,
  isValidLanguage,
  getExtensionsForLanguage,
  getSupportedLanguages,
} from './detector.js';

export {
  parseCodeContext,
  formatCodeContext,
  serializeCodeContext,
  deserializeCodeContext,
  enrichWithSourceHash,
} from './context.js';
