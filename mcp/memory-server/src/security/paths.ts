/**
 * Path validation for preventing directory traversal attacks
 * SC-002: Input validation - path traversal prevention
 */

import { resolve, normalize } from 'path';

/**
 * Check if a file path is safely within the project root
 * Prevents directory traversal attacks (e.g., ../../../etc/passwd)
 *
 * @param filePath - The file path to validate (can be relative or absolute)
 * @param projectRoot - The project root directory
 * @returns true if path is safe (within project root), false otherwise
 */
export function isPathSafe(filePath: string, projectRoot: string): boolean {
  if (!filePath || !projectRoot) {
    return false;
  }

  try {
    // Resolve the file path relative to project root
    const resolved = resolve(projectRoot, filePath);

    // Normalize both paths to handle any remaining ../ or ./ segments
    const normalizedResolved = normalize(resolved);
    const normalizedRoot = normalize(projectRoot);

    // Check if the resolved path starts with the project root
    // Add trailing separator to prevent partial matches (e.g., /project vs /project-other)
    const rootWithSep = normalizedRoot.endsWith('/') ? normalizedRoot : normalizedRoot + '/';
    const resolvedWithSep = normalizedResolved.endsWith('/')
      ? normalizedResolved
      : normalizedResolved + '/';

    // Path is safe if it starts with the root or equals the root exactly
    return (
      normalizedResolved === normalizedRoot ||
      normalizedResolved.startsWith(rootWithSep) ||
      resolvedWithSep.startsWith(rootWithSep)
    );
  } catch {
    // If path resolution fails, consider it unsafe
    return false;
  }
}

/**
 * Validate and sanitize a citation path
 * Returns null if the path is invalid or unsafe
 *
 * @param citation - Citation string (e.g., "src/file.ts:45")
 * @param projectRoot - The project root directory
 * @returns Sanitized file path or null if invalid/unsafe
 */
export function validateCitationPath(
  citation: string | null | undefined,
  projectRoot: string
): string | null {
  if (!citation || citation.trim() === '') {
    return null;
  }

  // Extract file path from citation (format: filepath[:line[-endline][:symbol]])
  const parts = citation.split(':');
  const filePath = parts[0];

  if (!filePath || filePath.trim() === '') {
    return null;
  }

  const trimmedPath = filePath.trim();

  // Check for safe path
  if (!isPathSafe(trimmedPath, projectRoot)) {
    return null;
  }

  return trimmedPath;
}
