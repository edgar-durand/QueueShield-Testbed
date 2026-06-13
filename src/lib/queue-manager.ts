import { redis } from './redis';
import { prisma } from './db';
import { v4 as uuidv4 } from 'uuid';
import { signToken } from './crypto';

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

  static async joinQueue(sessionId: string): Promise<{ queueToken: string; tokenSignature: string; position: number }> {
    const queueToken = uuidv4();
    const tokenSignature = signToken(queueToken);
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

    return { queueToken, tokenSignature, position };
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
        // Check session is not banned and is actually waiting in queue
        const session = await prisma.session.findUnique({
          where: { id: sessionId },
          select: { isBanned: true, riskLevel: true, status: true },
        });

        // Drop banned, missing (phantom), or non-waiting (e.g. CHALLENGED/EXPIRED)
        // sessions from the front so they don't block the line or get admitted.
        if (!session || session.isBanned || session.status !== 'IN_QUEUE') {
          await redis.zrem(QUEUE_KEY, sessionId);
          await redis.hdel(QUEUE_POSITIONS_KEY, sessionId);
          continue;
        }

        // Generate access token
        const accessToken = uuidv4();
        const ttl = parseInt(process.env.ACCESS_TOKEN_TTL_SECONDS || '120', 10);

        // Mark as admitted in Redis.
        // Note: expiry is enforced by QueueProcessor.cleanupExpiredTokens via the
        // DB accessTokenExpiresAt field — individual hash fields can't carry a TTL.
        await redis.hset(QUEUE_ADMITTED_KEY, sessionId, JSON.stringify({
          accessToken,
          admittedAt: Date.now(),
        }));

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
    const updates = topMembers
      // Phantom entries have no DB row — skip them to avoid failing updates.
      .map((sessionId, i) => ({ sessionId, position: i + 1 }))
      .filter(({ sessionId }) => !sessionId.startsWith('phantom-'))
      .map(({ sessionId, position }) =>
        prisma.session.update({
          where: { id: sessionId },
          data: { queuePosition: position },
        }).catch(() => { /* session may be deleted */ })
      );
    await Promise.all(updates);
  }

  /**
   * Re-insert a session into the queue (e.g. after it passes a CAPTCHA
   * challenge). It goes to the back of the queue with a fresh timestamp.
   */
  static async rejoinQueue(sessionId: string): Promise<number> {
    const now = Date.now();
    await redis.zadd(QUEUE_KEY, now, sessionId);
    await prisma.session.update({
      where: { id: sessionId },
      data: { status: 'IN_QUEUE', queueJoinedAt: new Date(now) },
    });
    const rank = (await redis.zrank(QUEUE_KEY, sessionId)) ?? 0;
    return rank + 1;
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
    // Atomically reserve a ticket and mark the session COMPLETED in one
    // transaction. The inventory update uses a compare-and-swap on the value we
    // just read, so two concurrent purchases can't both succeed past the last
    // ticket (prevents overselling). Retried a few times on contention.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const sold = await prisma.$transaction(async (tx) => {
          const event = await tx.eventConfig.findFirst({ where: { isActive: true } });

          if (event) {
            if (event.soldTickets >= event.totalTickets) {
              return false; // sold out
            }
            const reserved = await tx.eventConfig.updateMany({
              where: { id: event.id, soldTickets: event.soldTickets },
              data: { soldTickets: { increment: 1 } },
            });
            if (reserved.count === 0) {
              // Lost the race; surface as contention to trigger a retry.
              throw new Error('ticket_contention');
            }
          }

          await tx.session.update({
            where: { id: sessionId },
            data: { status: 'COMPLETED' },
          });
          return true;
        });

        if (sold) {
          await redis.hdel(QUEUE_ADMITTED_KEY, sessionId);
        }
        return sold;
      } catch (err) {
        if (err instanceof Error && err.message === 'ticket_contention') {
          continue; // retry
        }
        return false;
      }
    }
    return false;
  }
}
