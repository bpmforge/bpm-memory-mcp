/**
 * Language detection from file extensions
 * Supports 15+ programming languages
 */

import type { Language } from '../types.js';

/**
 * Extension to language mapping
 */
const EXTENSION_MAP: Record<string, Language> = {
  // TypeScript
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  // JavaScript
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  // Python
  py: 'python',
  pyw: 'python',
  pyi: 'python',
  // Rust
  rs: 'rust',
  // Go
  go: 'go',
  // Java
  java: 'java',
  // C
  c: 'c',
  h: 'c',
  // C++
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hxx: 'cpp',
  // Ruby
  rb: 'ruby',
  rake: 'ruby',
  // PHP
  php: 'php',
  // Shell
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  // SQL
  sql: 'sql',
  // Markdown
  md: 'markdown',
  mdx: 'markdown',
  // JSON
  json: 'json',
  jsonc: 'json',
  // YAML
  yaml: 'yaml',
  yml: 'yaml',
};

/**
 * Detect programming language from a citation string
 * @param citation - Citation like "src/file.ts:45" or "path/to/file.py"
 * @returns Detected language or null if unknown
 */
export function detectLanguage(citation: string | null | undefined): Language | null {
  if (!citation) return null;

  // Extract file path and extension
  // Handle formats: "file.ext", "file.ext:line", "file.ext:line-line"
  const filePart = citation.split(':')[0];
  if (!filePart) return null;

  // Get extension (last . segment)
  const lastDotIndex = filePart.lastIndexOf('.');
  if (lastDotIndex === -1) return null;

  const ext = filePart.slice(lastDotIndex + 1).toLowerCase();
  return EXTENSION_MAP[ext] || null;
}

/**
 * Check if a language value is valid
 */
export function isValidLanguage(lang: string): lang is Language {
  const validLanguages: Language[] = [
    'typescript', 'javascript', 'python', 'rust', 'go', 'java',
    'c', 'cpp', 'ruby', 'php', 'shell', 'sql',
    'markdown', 'json', 'yaml', 'other',
  ];
  return validLanguages.includes(lang as Language);
}

/**
 * Get all supported extensions for a language
 */
export function getExtensionsForLanguage(lang: Language): string[] {
  return Object.entries(EXTENSION_MAP)
    .filter(([_, l]) => l === lang)
    .map(([ext]) => ext);
}

/**
 * Get all supported languages
 */
export function getSupportedLanguages(): Language[] {
  return [...new Set(Object.values(EXTENSION_MAP))];
}
