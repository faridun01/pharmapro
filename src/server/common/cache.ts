/**
 * Simple in-memory cache with TTL support
 * Useful for caching expensive report computations
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class InMemoryCache {
  private store = new Map<string, CacheEntry<any>>();

  /**
   * Get cached value if exists and not expired
   */
  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return entry.value as T;
  }

  /**
   * Set value with TTL in milliseconds
   */
  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Invalidate specific cache key
   */
  invalidate(key: string): void {
    this.store.delete(key);
  }

  /**
   * Invalidate all keys matching pattern
   */
  invalidatePattern(pattern: RegExp): void {
    for (const key of this.store.keys()) {
      if (pattern.test(key)) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Get cache stats
   */
  getStats() {
    return {
      size: this.store.size,
      keys: Array.from(this.store.keys()),
    };
  }
}

export const reportCache = new InMemoryCache();

/**
 * Cache key generators for different report types
 */
export const CACHE_KEYS = {
  financeReport: (preset: string, from: string, to: string) => 
    `report:finance:${preset}:${from}:${to}`,
  dashboardMetrics: (userId: string) => 
    `metrics:dashboard:${userId}`,
  inventoryStatus: () => 
    `metrics:inventory:status`,
  activeShiftMetrics: (shiftId: string) => 
    `metrics:shift:${shiftId}`,
};

/**
 * TTL constants (in milliseconds)
 */
export const CACHE_TTL = {
  financeReport: 10 * 60 * 1000, // 10 minutes
  dashboardMetrics: 5 * 60 * 1000, // 5 minutes
  inventoryStatus: 2 * 60 * 1000, // 2 minutes
  activeShiftMetrics: 1 * 60 * 1000, // 1 minute
};
