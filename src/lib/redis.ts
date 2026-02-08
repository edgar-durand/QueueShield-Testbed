import Redis from 'ioredis';

const globalForRedis = globalThis as unknown as { redis: Redis | null };

function createRedisClient(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn('[QueueShield] REDIS_URL not set — Redis features disabled');
    return null;
  }
  try {
    return new Redis(url, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      retryStrategy(times) {
        if (times > 5) return null;
        const delay = Math.min(times * 200, 2000);
        return delay;
      },
    });
  } catch (err) {
    console.error('[QueueShield] Redis connection error:', err);
    return null;
  }
}

export const redis: Redis | null =
  globalForRedis.redis !== undefined ? globalForRedis.redis : createRedisClient();

if (process.env.NODE_ENV !== 'production') globalForRedis.redis = redis;
