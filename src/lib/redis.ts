import Redis from 'ioredis';

const globalForRedis = globalThis as unknown as { redis: Redis };

function createRedisClient(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn('[QueueShield] REDIS_URL not set — Redis features will fail at runtime');
    // Return a client that won't connect until actually used
    return new Redis({ lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 0 });
  }
  return new Redis(url, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    retryStrategy(times) {
      if (times > 5) return null;
      return Math.min(times * 200, 2000);
    },
  });
}

export const redis: Redis =
  globalForRedis.redis ?? createRedisClient();

if (process.env.NODE_ENV !== 'production') globalForRedis.redis = redis;
