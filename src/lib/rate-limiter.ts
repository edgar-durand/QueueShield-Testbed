import { redis } from './redis';

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export class RateLimiter {
  /**
   * Sliding window rate limiter using Redis.
   * @param key - Unique identifier (e.g. IP address or session ID)
   * @param limit - Max requests allowed in the window
   * @param windowSeconds - Time window in seconds
   */
  static async check(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const redisKey = `ratelimit:${key}`;

    const pipe = redis.pipeline();
    // Remove entries outside the window
    pipe.zremrangebyscore(redisKey, 0, now - windowMs);
    // Add current request
    pipe.zadd(redisKey, now, `${now}:${Math.random()}`);
    // Count entries in window
    pipe.zcard(redisKey);
    // Set expiry on the key
    pipe.expire(redisKey, windowSeconds);

    const results = await pipe.exec();
    const count = (results?.[2]?.[1] as number) || 0;

    if (count > limit) {
      // Find the oldest entry to calculate retry-after
      const oldest = await redis.zrange(redisKey, 0, 0, 'WITHSCORES');
      const oldestTime = oldest.length >= 2 ? parseInt(oldest[1], 10) : now;
      const retryAfterMs = (oldestTime + windowMs) - now;
      const retryAfterSeconds = Math.ceil(Math.max(retryAfterMs, 1000) / 1000);

      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds,
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: 0,
    };
  }

  /**
   * Prebuilt rate limit profiles
   */
  static readonly PROFILES = {
    // Queue join: 5 requests per 60 seconds per IP
    QUEUE_JOIN: { limit: 5, windowSeconds: 60 },
    // SSE connection: 10 per 60 seconds per IP
    SSE: { limit: 10, windowSeconds: 60 },
    // Fingerprint/telemetry submission: 20 per 60 seconds per session
    TELEMETRY: { limit: 20, windowSeconds: 60 },
    // Purchase: 3 per 60 seconds per session
    PURCHASE: { limit: 3, windowSeconds: 60 },
    // Admin API: 60 per 60 seconds
    ADMIN: { limit: 60, windowSeconds: 60 },
    // General API: 30 per 60 seconds per IP
    GENERAL: { limit: 30, windowSeconds: 60 },
  } as const;
}
