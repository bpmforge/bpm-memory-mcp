/**
 * Code context parsing from citation strings
 * Extracts structured information about code location
 */

import { SymbolType, type CodeContext } from '../types.js';

/**
 * Parse code context from a citation string
 *
 * Supported formats:
 * - "src/file.ts" -> { filePath: "src/file.ts", startLine: 1 }
 * - "src/file.ts:45" -> { filePath: "src/file.ts", startLine: 45 }
 * - "src/file.ts:45-120" -> { filePath: "src/file.ts", startLine: 45, endLine: 120 }
 * - "src/file.ts:45:MyClass" -> { filePath: "src/file.ts", startLine: 45, symbolName: "MyClass" }
 *
 * @param citation - Citation string
 * @returns Parsed code context or null if invalid
 */
export function parseCodeContext(citation: string | null | undefined): CodeContext | null {
  if (!citation || citation.trim() === '') return null;

  // Pattern: filepath[:startLine[-endLine][:symbolName]]
  // Examples:
  //   src/file.ts
  //   src/file.ts:45
  //   src/file.ts:45-120
  //   src/file.ts:45:MyClass
  //   src/file.ts:45-120:myFunction

  const parts = citation.split(':');
  if (parts.length === 0) return null;

  const filePath = parts[0]!;
  if (!filePath || filePath.trim() === '') return null;

  // Default: just file path, line 1
  const context: CodeContext = {
    filePath: filePath.trim(),
    startLine: 1,
  };

  if (parts.length >= 2 && parts[1]) {
    // Parse line numbers: "45" or "45-120"
    const linePart = parts[1];
    const lineMatch = linePart.match(/^(\d+)(?:-(\d+))?$/);

    if (lineMatch) {
      context.startLine = parseInt(lineMatch[1]!, 10);
      if (lineMatch[2]) {
        context.endLine = parseInt(lineMatch[2], 10);
      }
    }
  }

  if (parts.length >= 3 && parts[2]) {
    // Parse symbol name
    const symbolName = parts[2].trim();
    if (symbolName) {
      context.symbolName = symbolName;
      const inferred = inferSymbolType(symbolName);
      if (inferred) {
        context.symbolType = inferred;
      }
    }
  }

  return context;
}

/**
 * Infer symbol type from name conventions
 */
function inferSymbolType(name: string): SymbolType | undefined {
  // PascalCase usually indicates a class or type
  if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
    // Check for common type suffixes
    if (name.endsWith('Type') || name.endsWith('Interface') || name.endsWith('Props')) {
      return SymbolType.TYPE;
    }
    return SymbolType.CLASS;
  }

  // camelCase or snake_case with parens suggests function
  if (name.endsWith('()')) {
    return SymbolType.FUNCTION;
  }

  // UPPER_CASE suggests constant/variable
  if (/^[A-Z_][A-Z0-9_]*$/.test(name)) {
    return SymbolType.VARIABLE;
  }

  // Default to function for camelCase
  if (/^[a-z][a-zA-Z0-9]*$/.test(name)) {
    return SymbolType.FUNCTION;
  }

  return undefined;
}

/**
 * Format code context back to citation string
 */
export function formatCodeContext(context: CodeContext): string {
  let citation = context.filePath;

  if (context.startLine > 1 || context.endLine || context.symbolName) {
    citation += `:${context.startLine}`;

    if (context.endLine) {
      citation += `-${context.endLine}`;
    }

    if (context.symbolName) {
      citation += `:${context.symbolName}`;
    }
  }

  return citation;
}

/**
 * Serialize code context to JSON for database storage
 */
export function serializeCodeContext(context: CodeContext): string {
  return JSON.stringify(context);
}

/**
 * Deserialize code context from JSON
 */
export function deserializeCodeContext(json: string | null): CodeContext | null {
  if (!json) return null;

  try {
    const parsed = JSON.parse(json);

    // Validate required fields
    if (typeof parsed.filePath !== 'string' || typeof parsed.startLine !== 'number') {
      return null;
    }

    return {
      filePath: parsed.filePath,
      startLine: parsed.startLine,
      endLine: typeof parsed.endLine === 'number' ? parsed.endLine : undefined,
      symbolName: typeof parsed.symbolName === 'string' ? parsed.symbolName : undefined,
      symbolType: parsed.symbolType,
    };
  } catch {
    return null;
  }
}
