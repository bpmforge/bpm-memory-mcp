import { createHash } from 'crypto';
import type { DatabaseConnection } from '../storage/database.js';

/**
 * Embedding cache using content hash
 * Avoids recomputation for duplicate content
 */
export class EmbeddingCache {
  private memoryCache: Map<string, Float32Array> = new Map();
  private maxMemoryEntries = 1000;

  constructor(private db?: DatabaseConnection) {}

  /**
   * Get cached embedding by content
   */
  get(content: string): Float32Array | null {
    const hash = this.hashContent(content);

    // Check memory cache first
    const memCached = this.memoryCache.get(hash);
    if (memCached) {
      return memCached;
    }

    // Check database if available
    if (this.db) {
      const dbCached = this.getFromDb(hash);
      if (dbCached) {
        // Promote to memory cache
        this.setMemoryCache(hash, dbCached);
        return dbCached;
      }
    }

    return null;
  }

  /**
   * Cache an embedding
   */
  set(content: string, embedding: Float32Array): void {
    const hash = this.hashContent(content);
    this.setMemoryCache(hash, embedding);
  }

  /**
   * Check if content is cached
   */
  has(content: string): boolean {
    const hash = this.hashContent(content);
    return this.memoryCache.has(hash) || this.hasInDb(hash);
  }

  /**
   * Get embedding by content hash
   */
  getByHash(hash: string): Float32Array | null {
    return this.memoryCache.get(hash) ?? this.getFromDb(hash);
  }

  /**
   * Clear memory cache
   */
  clearMemory(): void {
    this.memoryCache.clear();
  }

  /**
   * Get cache statistics
   */
  stats(): { memoryEntries: number; hitRate: number } {
    return {
      memoryEntries: this.memoryCache.size,
      hitRate: 0, // Would need to track hits/misses for this
    };
  }

  /**
   * Hash content for cache key
   */
  hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  private setMemoryCache(hash: string, embedding: Float32Array): void {
    // Evict oldest if at capacity (simple FIFO)
    if (this.memoryCache.size >= this.maxMemoryEntries) {
      const firstKey = this.memoryCache.keys().next().value;
      if (firstKey) {
        this.memoryCache.delete(firstKey);
      }
    }
    this.memoryCache.set(hash, embedding);
  }

  private getFromDb(hash: string): Float32Array | null {
    if (!this.db) return null;

    try {
      const row = this.db.instance
        .prepare(
          `SELECT embedding FROM memories
           WHERE content_hash = ? AND embedding IS NOT NULL
           LIMIT 1`
        )
        .get(hash) as { embedding: Buffer } | undefined;
      if (row?.embedding) {
        return new Float32Array(row.embedding.buffer);
      }
    } catch {
      // Database not ready or query failed
    }

    return null;
  }

  private hasInDb(hash: string): boolean {
    if (!this.db) return false;

    try {
      const row = this.db.instance
        .prepare(
          `SELECT 1 FROM memories
           WHERE content_hash = ? AND embedding IS NOT NULL
           LIMIT 1`
        )
        .get(hash);

      return row !== undefined;
    } catch {
      return false;
    }
  }
}
