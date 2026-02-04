import type { GoalState } from '../types.js';

/**
 * Drift detection result
 */
export interface DriftResult {
  indicator: number; // 0-1, higher = more drift
  isWarning: boolean; // true if indicator > 0.7
  activeGoalCount: number;
  timeSinceLastCheck: number; // seconds
  topGoals: Array<{ content: string; priority: number }>;
}

/**
 * Extract keywords from text for comparison
 */
function extractKeywords(text: string): Set<string> {
  // Normalize and tokenize
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);

  // Filter common stop words
  const stopWords = new Set([
    'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
    'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'will',
    'this', 'that', 'with', 'from', 'they', 'which', 'their', 'would',
    'there', 'could', 'should', 'about', 'into', 'more', 'other', 'than',
    'then', 'these', 'some', 'what', 'when', 'where', 'just', 'also',
  ]);

  return new Set(words.filter((w) => !stopWords.has(w)));
}

/**
 * Calculate Jaccard similarity between two sets
 */
function jaccardSimilarity(set1: Set<string>, set2: Set<string>): number {
  if (set1.size === 0 && set2.size === 0) return 1;
  if (set1.size === 0 || set2.size === 0) return 0;

  const intersection = new Set([...set1].filter((x) => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  return intersection.size / union.size;
}

/**
 * Calculate drift indicator based on goals and recent context
 *
 * @param activeGoals - Currently active goals
 * @param recentContext - Recent conversation/work context
 * @param timeSinceGoalActivity - Seconds since last goal-related activity
 * @param lastCheckTime - Timestamp of last drift check (optional)
 * @returns Drift indicator between 0 (on-track) and 1 (completely drifted)
 */
export function calculateDriftIndicator(
  activeGoals: GoalState[],
  recentContext: string,
  timeSinceGoalActivity: number,
  lastCheckTime?: Date
): DriftResult {
  // No active goals = no drift tracking needed
  if (activeGoals.length === 0) {
    return {
      indicator: 0,
      isWarning: false,
      activeGoalCount: 0,
      timeSinceLastCheck: lastCheckTime
        ? Math.floor((Date.now() - lastCheckTime.getTime()) / 1000)
        : 0,
      topGoals: [],
    };
  }

  // Extract keywords from all active goals (weighted by priority)
  const goalKeywords = new Set<string>();
  for (const goal of activeGoals) {
    const keywords = extractKeywords(goal.content);
    // Higher priority goals (lower number) get their keywords added multiple times
    const weight = 6 - goal.priority; // priority 1 -> weight 5, priority 5 -> weight 1
    for (let i = 0; i < weight; i++) {
      keywords.forEach((k) => goalKeywords.add(k));
    }
  }

  // Extract keywords from recent context
  const contextKeywords = extractKeywords(recentContext);

  // Calculate keyword overlap
  const keywordSimilarity = jaccardSimilarity(goalKeywords, contextKeywords);

  // Time decay factor (increases drift indicator over time without goal activity)
  // After 5 minutes of no goal activity, starts adding to drift
  // After 30 minutes, adds 0.3 to drift indicator
  const TIME_DECAY_START = 5 * 60; // 5 minutes
  const TIME_DECAY_MAX = 30 * 60; // 30 minutes
  const MAX_TIME_CONTRIBUTION = 0.3;

  let timeContribution = 0;
  if (timeSinceGoalActivity > TIME_DECAY_START) {
    const decayProgress = Math.min(
      1,
      (timeSinceGoalActivity - TIME_DECAY_START) / (TIME_DECAY_MAX - TIME_DECAY_START)
    );
    timeContribution = decayProgress * MAX_TIME_CONTRIBUTION;
  }

  // Calculate drift indicator
  // Low keyword similarity = high drift
  // High time since activity = additional drift
  const keywordDrift = 1 - keywordSimilarity;
  const rawIndicator = keywordDrift * 0.7 + timeContribution;

  // Clamp to 0-1 range
  const indicator = Math.max(0, Math.min(1, rawIndicator));

  // Get top goals by priority
  const topGoals = activeGoals
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 3)
    .map((g) => ({ content: g.content, priority: g.priority }));

  return {
    indicator,
    isWarning: indicator > 0.7,
    activeGoalCount: activeGoals.length,
    timeSinceLastCheck: lastCheckTime
      ? Math.floor((Date.now() - lastCheckTime.getTime()) / 1000)
      : 0,
    topGoals,
  };
}

/**
 * Generate a drift warning message
 */
export function getDriftWarningMessage(result: DriftResult): string | null {
  if (!result.isWarning) {
    return null;
  }

  const goalSummary = result.topGoals
    .map((g) => `[P${g.priority}] ${g.content.substring(0, 50)}...`)
    .join('\n  ');

  return `Drift warning: Current work may be drifting from session goals.
Drift indicator: ${(result.indicator * 100).toFixed(0)}%
Active goals (${result.activeGoalCount}):
  ${goalSummary}

Consider reviewing your goals with goal_anchor({ action: 'check' }).`;
}

/**
 * Determine if context is relevant to a specific goal
 */
export function isContextRelevantToGoal(context: string, goal: GoalState): boolean {
  const contextKeywords = extractKeywords(context);
  const goalKeywords = extractKeywords(goal.content);

  const similarity = jaccardSimilarity(contextKeywords, goalKeywords);

  // Consider relevant if at least 20% keyword overlap
  return similarity >= 0.2;
}
