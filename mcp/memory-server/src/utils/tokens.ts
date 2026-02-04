/**
 * Token Estimation Utilities (V12)
 *
 * Simple token estimation without external dependencies.
 * Uses word-based approximation: ~1.3 tokens per word for English text.
 * For code, uses ~1.5 tokens per word due to special characters.
 */

/**
 * Estimate token count for a string
 * Uses simple word-based heuristic that's reasonably accurate for Claude
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  // Count words (split on whitespace and punctuation)
  const words = text.split(/[\s]+/).filter(w => w.length > 0);

  // Check if content is likely code (has many special characters)
  const specialCharRatio = (text.match(/[{}[\]();:=<>|&!@#$%^*+/\\]/g) || []).length / text.length;
  const isCode = specialCharRatio > 0.1;

  // Apply multiplier based on content type
  const multiplier = isCode ? 1.5 : 1.3;

  return Math.ceil(words.length * multiplier);
}

/**
 * Truncate text to fit within a token budget
 * Tries to break at sentence boundaries when possible
 */
export function truncateToTokenBudget(
  text: string,
  maxTokens: number,
  options: { suffix?: string; preserveStart?: boolean } = {}
): { text: string; truncated: boolean; estimatedTokens: number } {
  const { suffix = '...', preserveStart = true } = options;

  const currentTokens = estimateTokens(text);
  if (currentTokens <= maxTokens) {
    return { text, truncated: false, estimatedTokens: currentTokens };
  }

  // Reserve tokens for suffix
  const suffixTokens = estimateTokens(suffix);
  const targetTokens = maxTokens - suffixTokens;

  if (targetTokens <= 0) {
    return { text: suffix, truncated: true, estimatedTokens: suffixTokens };
  }

  // Estimate character limit based on token target
  // Average ~4 characters per token
  const estimatedCharLimit = targetTokens * 4;

  let truncatedText: string;
  if (preserveStart) {
    // Find a good break point (sentence or line boundary)
    const searchText = text.slice(0, estimatedCharLimit + 100);
    const sentenceBreaks = [...searchText.matchAll(/[.!?]\s+/g)];
    const lineBreaks = [...searchText.matchAll(/\n/g)];

    // Find the last break point within our limit
    let breakPoint = estimatedCharLimit;
    for (const match of [...sentenceBreaks, ...lineBreaks].reverse()) {
      if (match.index && match.index < estimatedCharLimit) {
        breakPoint = match.index + match[0].length;
        break;
      }
    }

    truncatedText = text.slice(0, breakPoint).trim() + suffix;
  } else {
    // Truncate from the end (less common use case)
    truncatedText = suffix + text.slice(-estimatedCharLimit).trim();
  }

  return {
    text: truncatedText,
    truncated: true,
    estimatedTokens: estimateTokens(truncatedText),
  };
}

/**
 * Fit multiple items within a token budget
 * Prioritizes items by their order (first items get more space)
 */
export function fitItemsToTokenBudget<T extends { content: string }>(
  items: T[],
  maxTokens: number,
  options: {
    headerTokens?: number; // Reserved tokens for headers/formatting
    itemOverhead?: number; // Tokens per item for formatting (bullets, newlines)
    minItemTokens?: number; // Minimum tokens per item
  } = {}
): { items: T[]; truncatedContents: Map<string, string>; totalTokens: number; itemsIncluded: number } {
  const {
    headerTokens = 50,
    itemOverhead = 5,
    minItemTokens = 20,
  } = options;

  let availableTokens = maxTokens - headerTokens;
  const result: T[] = [];
  const truncatedContents = new Map<string, string>();
  let totalTokens = headerTokens;

  for (const item of items) {
    if (availableTokens <= minItemTokens + itemOverhead) {
      break; // No more room
    }

    const itemTokens = estimateTokens(item.content);
    const budgetForItem = Math.min(itemTokens, availableTokens - itemOverhead);

    if (budgetForItem < minItemTokens) {
      break; // Not enough space for a meaningful entry
    }

    if (itemTokens <= budgetForItem) {
      // Item fits completely
      result.push(item);
      totalTokens += itemTokens + itemOverhead;
      availableTokens -= itemTokens + itemOverhead;
    } else {
      // Need to truncate
      const { text: truncated, estimatedTokens } = truncateToTokenBudget(
        item.content,
        budgetForItem
      );
      truncatedContents.set(item.content, truncated);
      result.push({ ...item, content: truncated });
      totalTokens += estimatedTokens + itemOverhead;
      availableTokens -= estimatedTokens + itemOverhead;
    }
  }

  return {
    items: result,
    truncatedContents,
    totalTokens,
    itemsIncluded: result.length,
  };
}

/**
 * Default token budgets for different contexts
 */
export const TOKEN_BUDGETS = {
  /** Quick context check */
  minimal: 500,
  /** Standard context assembly */
  standard: 2000,
  /** Detailed context with full memories */
  detailed: 4000,
  /** Maximum recommended context */
  maximum: 8000,
} as const;
