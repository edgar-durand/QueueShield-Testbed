import { redis } from './redis';
import { prisma } from './db';
import { v4 as uuidv4 } from 'uuid';

const QUEUE_KEY = 'queueshield:queue';
const QUEUE_POSITIONS_KEY = 'queueshield:positions';
const QUEUE_ADMITTED_KEY = 'queueshield:admitted';

export interface QueueEntry {
  sessionId: string;
  joinedAt: number;
  position: number;
}

export interface QueueStatus {
  position: number;
  totalInQueue: number;
  estimatedWaitSeconds: number;
  status: 'waiting' | 'admitted' | 'removed';
  accessToken?: string;
  accessUrl?: string;
}

export class QueueManager {
  private static processIntervalMs = parseInt(process.env.QUEUE_PROCESS_INTERVAL_MS || '3000', 10);
  private static batchSize = parseInt(process.env.QUEUE_BATCH_SIZE || '5', 10);

  static async joinQueue(sessionId: string): Promise<{ queueToken: string; position: number }> {
    const queueToken = uuidv4();
    const now = Date.now();

    // Add to Redis sorted set (score = timestamp for FIFO ordering)
    await redis.zadd(QUEUE_KEY, now, sessionId);

    // Store queue token mapping
    await redis.hset(QUEUE_POSITIONS_KEY, sessionId, JSON.stringify({
      queueToken,
      joinedAt: now,
    }));

    // Get position (1-indexed)
    const position = (await redis.zrank(QUEUE_KEY, sessionId) ?? 0) + 1;

    // Update database
    await prisma.session.update({
      where: { id: sessionId },
      data: {
        status: 'IN_QUEUE',
        queueToken,
        queuePosition: position,
        queueJoinedAt: new Date(now),
      },
    });

    return { queueToken, position };
  }

  static async getQueueStatus(sessionId: string): Promise<QueueStatus> {
    // Check if already admitted
    const admitted = await redis.hget(QUEUE_ADMITTED_KEY, sessionId);
    if (admitted) {
      const data = JSON.parse(admitted);
      return {
        position: 0,
        totalInQueue: await redis.zcard(QUEUE_KEY),
        estimatedWaitSeconds: 0,
        status: 'admitted',
        accessToken: data.accessToken,
        accessUrl: `/purchase/${data.accessToken}`,
      };
    }

    // Check if still in queue
    const rank = await redis.zrank(QUEUE_KEY, sessionId);
    if (rank === null) {
      return {
        position: -1,
        totalInQueue: await redis.zcard(QUEUE_KEY),
        estimatedWaitSeconds: 0,
        status: 'removed',
      };
    }

    const position = rank + 1;
    const totalInQueue = await redis.zcard(QUEUE_KEY);
    const estimatedWaitSeconds = Math.ceil(
      (position / this.batchSize) * (this.processIntervalMs / 1000)
    );

    return {
      position,
      totalInQueue,
      estimatedWaitSeconds,
      status: 'waiting',
    };
  }

  static async processQueue(): Promise<string[]> {
    // Get the next batch of sessions from the front of the queue
    const sessionIds = await redis.zrange(QUEUE_KEY, 0, this.batchSize - 1);
    if (sessionIds.length === 0) return [];

    const admittedIds: string[] = [];

    for (const sessionId of sessionIds) {
      try {
        // Check session is not banned
        const session = await prisma.session.findUnique({
          where: { id: sessionId },
          select: { isBanned: true, riskLevel: true },
        });

        if (!session || session.isBanned) {
          await redis.zrem(QUEUE_KEY, sessionId);
          await redis.hdel(QUEUE_POSITIONS_KEY, sessionId);
          continue;
        }

        // Generate access token
        const accessToken = uuidv4();
        const ttl = parseInt(process.env.ACCESS_TOKEN_TTL_SECONDS || '120', 10);

        // Mark as admitted in Redis
        await redis.hset(QUEUE_ADMITTED_KEY, sessionId, JSON.stringify({
          accessToken,
          admittedAt: Date.now(),
        }));

        // Set TTL on the admission
        await redis.expire(`${QUEUE_ADMITTED_KEY}:${sessionId}`, ttl);

        // Remove from queue
        await redis.zrem(QUEUE_KEY, sessionId);
        await redis.hdel(QUEUE_POSITIONS_KEY, sessionId);

        // Update database
        await prisma.session.update({
          where: { id: sessionId },
          data: {
            status: 'ADMITTED',
            accessToken,
            accessTokenExpiresAt: new Date(Date.now() + ttl * 1000),
            queuePosition: 0,
          },
        });

        admittedIds.push(sessionId);
      } catch (err) {
        console.error(`Failed to process queue entry ${sessionId}:`, err);
      }
    }

    return admittedIds;
  }

  /**
   * Refresh queue positions for the first N sessions only (visible window).
   * Avoids O(N) DB writes for the entire queue.
   */
  static async refreshPositions(limit = 100): Promise<void> {
    const topMembers = await redis.zrange(QUEUE_KEY, 0, limit - 1);
    const updates = topMembers.map((sessionId, i) =>
      prisma.session.update({
        where: { id: sessionId },
        data: { queuePosition: i + 1 },
      }).catch(() => { /* session may be deleted */ })
    );
    await Promise.all(updates);
  }

  static async removeFromQueue(sessionId: string): Promise<void> {
    await redis.zrem(QUEUE_KEY, sessionId);
    await redis.hdel(QUEUE_POSITIONS_KEY, sessionId);
    await redis.hdel(QUEUE_ADMITTED_KEY, sessionId);
  }

  static async getQueueLength(): Promise<number> {
    return redis.zcard(QUEUE_KEY);
  }

  static async getAdmittedCount(): Promise<number> {
    return redis.hlen(QUEUE_ADMITTED_KEY);
  }

  static async validateAccessToken(token: string): Promise<{ valid: boolean; sessionId?: string }> {
    const session = await prisma.session.findUnique({
      where: { accessToken: token },
      select: { id: true, status: true, accessTokenExpiresAt: true, isBanned: true },
    });

    if (!session) return { valid: false };
    if (session.isBanned) return { valid: false };
    if (session.status !== 'ADMITTED' && session.status !== 'PURCHASING') return { valid: false };
    if (session.accessTokenExpiresAt && session.accessTokenExpiresAt < new Date()) {
      return { valid: false };
    }

    return { valid: true, sessionId: session.id };
  }

  static async completePurchase(sessionId: string): Promise<boolean> {
    try {
      await prisma.session.update({
        where: { id: sessionId },
        data: { status: 'COMPLETED' },
      });

      await redis.hdel(QUEUE_ADMITTED_KEY, sessionId);

      // Increment sold tickets
      const event = await prisma.eventConfig.findFirst({ where: { isActive: true } });
      if (event) {
        await prisma.eventConfig.update({
          where: { id: event.id },
          data: { soldTickets: { increment: 1 } },
        });
      }

      return true;
    } catch {
      return false;
    }
  }
}
