/**
 * Credential detection for preventing secret storage
 * SC-001: Input validation - credential filtering
 */

/**
 * Patterns that commonly indicate credentials or secrets
 */
const CREDENTIAL_PATTERNS: RegExp[] = [
  // Key-value patterns with common secret keywords
  /password\s*[:=]\s*['"][^'"]+['"]/gi,
  /api[_-]?key\s*[:=]\s*['"][^'"]+['"]/gi,
  /secret\s*[:=]\s*['"][^'"]+['"]/gi,
  /token\s*[:=]\s*['"][^'"]+['"]/gi,
  /auth[_-]?token\s*[:=]\s*['"][^'"]+['"]/gi,
  /access[_-]?token\s*[:=]\s*['"][^'"]+['"]/gi,
  /private[_-]?key\s*[:=]\s*['"][^'"]+['"]/gi,

  // Bearer tokens
  /bearer\s+[a-zA-Z0-9_\-\.]+/gi,

  // Private keys
  /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/i,
  /-----BEGIN\s+OPENSSH\s+PRIVATE\s+KEY-----/i,
  /-----BEGIN\s+EC\s+PRIVATE\s+KEY-----/i,
  /-----BEGIN\s+PGP\s+PRIVATE\s+KEY\s+BLOCK-----/i,

  // AWS credentials
  /aws[_-]?secret[_-]?access[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9/+=]+['"]?/gi,
  /aws[_-]?access[_-]?key[_-]?id\s*[:=]\s*['"]?[A-Z0-9]+['"]?/gi,

  // Database connection strings with credentials
  /mongodb(\+srv)?:\/\/[^:]+:[^@]+@/gi,
  /postgres(ql)?:\/\/[^:]+:[^@]+@/gi,
  /mysql:\/\/[^:]+:[^@]+@/gi,
  /redis:\/\/:[^@]+@/gi,

  // GitHub/GitLab tokens (common patterns)
  /gh[pousr]_[A-Za-z0-9_]{36,}/g,
  /glpat-[A-Za-z0-9_\-]{20,}/g,

  // Generic high-entropy strings that look like secrets (40+ char alphanumeric)
  /['"]\s*[A-Za-z0-9+/=]{40,}\s*['"]/g,
];

/**
 * Check if content contains potential credentials or secrets
 *
 * @param content - Content to check
 * @returns true if credentials detected, false otherwise
 */
export function containsCredentials(content: string): boolean {
  for (const pattern of CREDENTIAL_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    if (pattern.test(content)) {
      return true;
    }
  }
  return false;
}

/**
 * Get list of credential patterns matched (for debugging/logging)
 *
 * @param content - Content to check
 * @returns Array of matched pattern descriptions
 */
export function getCredentialMatches(content: string): string[] {
  const matches: string[] = [];

  for (const pattern of CREDENTIAL_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) {
      // Create a descriptive name from the pattern
      const patternStr = pattern.source;
      if (patternStr.includes('password')) matches.push('password');
      else if (patternStr.includes('api[_-]?key')) matches.push('api_key');
      else if (patternStr.includes('secret')) matches.push('secret');
      else if (patternStr.includes('token')) matches.push('token');
      else if (patternStr.includes('bearer')) matches.push('bearer_token');
      else if (patternStr.includes('PRIVATE')) matches.push('private_key');
      else if (patternStr.includes('aws')) matches.push('aws_credential');
      else if (patternStr.includes('mongodb')) matches.push('mongodb_connection');
      else if (patternStr.includes('postgres')) matches.push('postgres_connection');
      else if (patternStr.includes('mysql')) matches.push('mysql_connection');
      else if (patternStr.includes('redis')) matches.push('redis_connection');
      else if (patternStr.includes('gh[pousr]')) matches.push('github_token');
      else if (patternStr.includes('glpat')) matches.push('gitlab_token');
      else matches.push('high_entropy_string');
    }
  }

  return [...new Set(matches)]; // Remove duplicates
}
