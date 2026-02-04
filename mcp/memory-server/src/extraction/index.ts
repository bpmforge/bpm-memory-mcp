/**
 * Memory Auto-Extraction Engine (V9)
 *
 * Analyzes text content and extracts memory candidates using:
 * - Pattern matching for common memory types
 * - Keyword detection
 * - Confidence scoring
 */

import { MemoryType } from '../types.js';

export interface ExtractionCandidate {
  content: string;
  type: MemoryType;
  confidence: number;
  reason: string;
  keywords: string[];
  citation?: string;
}

export interface ExtractionResult {
  candidates: ExtractionCandidate[];
  stats: {
    totalPatterns: number;
    matchedPatterns: number;
    extractionTimeMs: number;
  };
}

// Pattern definitions for each memory type
interface ExtractionPattern {
  type: MemoryType;
  patterns: RegExp[];
  keywords: string[];
  baseConfidence: number;
}

const EXTRACTION_PATTERNS: ExtractionPattern[] = [
  // Decision patterns
  {
    type: MemoryType.DECISION,
    patterns: [
      /(?:decided|chose|chosen|selected|picked|went with|opted for|using)\s+(.+?)(?:\s+because|\s+since|\s+as|\s+for|\.|$)/gi,
      /(?:will|going to|plan to)\s+(?:use|implement|adopt|go with)\s+(.+?)(?:\s+because|\s+since|\.|$)/gi,
      /(?:the|our)\s+(?:approach|strategy|solution|choice|decision)\s+(?:is|was|will be)\s+(.+?)(?:\.|$)/gi,
      /(?:instead of|rather than)\s+(.+?),?\s+(?:we|I)(?:'ll|'m| will| am)\s+(.+?)(?:\.|$)/gi,
    ],
    keywords: ['decision', 'chose', 'decided', 'approach', 'strategy', 'because', 'instead of', 'opted', 'selected'],
    baseConfidence: 0.75,
  },
  // Error/fix patterns
  {
    type: MemoryType.ERROR,
    patterns: [
      /(?:error|bug|issue|problem)(?:\s+was)?:?\s*(.+?)(?:\.\s*(?:fixed|resolved|solved)|$)/gi,
      /(?:fixed|resolved|solved)\s+(?:by|with|using)\s+(.+?)(?:\.|$)/gi,
      /(?:the\s+)?(?:fix|solution|workaround)\s+(?:is|was)\s+(.+?)(?:\.|$)/gi,
      /(?:failed|failing)\s+(?:because|due to|with)\s+(.+?)(?:\.|$)/gi,
    ],
    keywords: ['error', 'bug', 'fix', 'fixed', 'resolved', 'solution', 'workaround', 'failed', 'issue', 'problem'],
    baseConfidence: 0.8,
  },
  // Pattern/approach patterns
  {
    type: MemoryType.PATTERN,
    patterns: [
      /(?:pattern|approach|technique|method|way to)\s+(?:for|to|of)\s+(.+?)(?:\.|$)/gi,
      /(?:always|usually|typically|best practice)\s+(.+?)(?:\s+when|\s+for|\.|$)/gi,
      /(?:the right way|correct way|proper way)\s+to\s+(.+?)(?:\.|$)/gi,
      /(?:learned|discovered|found)\s+that\s+(.+?)(?:\.|$)/gi,
    ],
    keywords: ['pattern', 'approach', 'technique', 'best practice', 'always', 'typically', 'learned', 'discovered'],
    baseConfidence: 0.7,
  },
  // Preference patterns
  {
    type: MemoryType.PREFERENCE,
    patterns: [
      /(?:prefer|like|want)\s+(?:to\s+)?(?:use|have|keep)\s+(.+?)(?:\.|$)/gi,
      /(?:user|they|client)\s+(?:prefers?|wants?|likes?)\s+(.+?)(?:\.|$)/gi,
      /(?:always|never)\s+(?:use|do|include|add)\s+(.+?)(?:\.|$)/gi,
      /(?:style|convention|standard)\s+(?:is|should be)\s+(.+?)(?:\.|$)/gi,
    ],
    keywords: ['prefer', 'preference', 'style', 'convention', 'always', 'never', 'want', 'like'],
    baseConfidence: 0.7,
  },
  // Fact patterns
  {
    type: MemoryType.FACT,
    patterns: [
      /(?:note|important|remember)(?:\s+that)?:?\s+(.+?)(?:\.|$)/gi,
      /(?:file|function|class|module|component)\s+(?:is|does|handles|contains)\s+(.+?)(?:\.|$)/gi,
      /(?:located|found|stored)\s+(?:at|in)\s+(.+?)(?:\.|$)/gi,
      /(?:requires?|needs?|depends? on)\s+(.+?)(?:\.|$)/gi,
    ],
    keywords: ['note', 'important', 'remember', 'located', 'requires', 'needs', 'contains', 'handles'],
    baseConfidence: 0.65,
  },
];

// Source-specific boosters
const SOURCE_BOOSTERS: Record<string, { types: MemoryType[]; boost: number }> = {
  error: { types: [MemoryType.ERROR], boost: 0.15 },
  code_change: { types: [MemoryType.DECISION, MemoryType.FACT], boost: 0.1 },
  session_summary: { types: [MemoryType.DECISION, MemoryType.PATTERN], boost: 0.1 },
  conversation: { types: [MemoryType.PREFERENCE, MemoryType.DECISION], boost: 0.05 },
};

/**
 * Extract memory candidates from text content
 */
export function extractMemories(
  content: string,
  source: string,
  context?: string
): ExtractionResult {
  const startTime = Date.now();
  const candidates: ExtractionCandidate[] = [];
  let matchedPatterns = 0;
  const totalPatterns = EXTRACTION_PATTERNS.reduce((sum, p) => sum + p.patterns.length, 0);

  // Combine content and context for analysis
  const fullText = context ? `${context}\n\n${content}` : content;

  for (const patternDef of EXTRACTION_PATTERNS) {
    for (const pattern of patternDef.patterns) {
      // Reset regex state
      pattern.lastIndex = 0;

      let match;
      while ((match = pattern.exec(fullText)) !== null) {
        matchedPatterns++;

        // Extract the matched content
        const extractedContent = match[1]?.trim() || match[0].trim();

        // Skip if too short or too long
        if (extractedContent.length < 10 || extractedContent.length > 500) {
          continue;
        }

        // Calculate confidence
        let confidence = patternDef.baseConfidence;

        // Boost for keyword presence
        const keywordCount = patternDef.keywords.filter(kw =>
          fullText.toLowerCase().includes(kw.toLowerCase())
        ).length;
        confidence += keywordCount * 0.02;

        // Source-specific boost
        const booster = SOURCE_BOOSTERS[source];
        if (booster && booster.types.includes(patternDef.type)) {
          confidence += booster.boost;
        }

        // Cap confidence at 0.95
        confidence = Math.min(0.95, confidence);

        // Extract keywords from the content
        const contentWords = extractedContent.toLowerCase().split(/\s+/);
        const matchedKeywords = patternDef.keywords.filter(kw =>
          contentWords.some(w => w.includes(kw.toLowerCase()))
        );

        // Build a better content string with context
        let finalContent = extractedContent;

        // For errors, try to include the fix
        if (patternDef.type === 'error' && match[2]) {
          finalContent = `${extractedContent}. Fix: ${match[2].trim()}`;
        }

        // Check for duplicates in candidates
        const isDuplicate = candidates.some(c =>
          c.content.toLowerCase() === finalContent.toLowerCase() ||
          (c.content.length > 20 && finalContent.includes(c.content.substring(0, 20)))
        );

        if (!isDuplicate) {
          candidates.push({
            content: finalContent,
            type: patternDef.type,
            confidence: Math.round(confidence * 100) / 100,
            reason: `Matched ${patternDef.type} pattern`,
            keywords: matchedKeywords,
          });
        }
      }
    }
  }

  // Sort by confidence
  candidates.sort((a, b) => b.confidence - a.confidence);

  // Limit to top 10 candidates
  const topCandidates = candidates.slice(0, 10);

  return {
    candidates: topCandidates,
    stats: {
      totalPatterns,
      matchedPatterns,
      extractionTimeMs: Date.now() - startTime,
    },
  };
}

/**
 * Enhance extraction content with citation if code-related
 */
export function detectCitation(content: string): string | undefined {
  // Look for file paths
  const fileMatch = content.match(/(?:in|at|from)\s+([\/\w.-]+\.[a-z]+)(?::(\d+))?/i);
  if (fileMatch) {
    const path = fileMatch[1];
    const line = fileMatch[2];
    return line ? `${path}:${line}` : path;
  }

  // Look for function/class references
  const codeMatch = content.match(/(?:function|class|method|component)\s+[`']?(\w+)[`']?/i);
  if (codeMatch) {
    return codeMatch[1];
  }

  return undefined;
}
