import { QueueManager } from './queue-manager';
import { prisma } from './db';
import { redis } from './redis';
import { SessionManager } from './session-manager';

let isRunning = false;
const handles: ReturnType<typeof setInterval>[] = [];

const PROCESS_INTERVAL_MS = parseInt(process.env.QUEUE_PROCESS_INTERVAL_MS || '3000', 10);
const TOKEN_EXPIRY_CLEANUP_MS = 10_000; // every 10s (was 60s)
const SESSION_GC_MS = 30_000; // every 30s (was 5 min)
const POSITION_REFRESH_MS = 5_000; // refresh visible positions every 5s
const STATS_LOG_MS = 15_000; // log stats every 15s

export class QueueProcessor {
  static start(): void {
    if (isRunning) return;
    isRunning = true;

    const batchSize = parseInt(process.env.QUEUE_BATCH_SIZE || '5', 10);
    console.log(`[QueueProcessor] Starting (interval: ${PROCESS_INTERVAL_MS}ms, batch: ${batchSize})`);

    // Queue admit loop
    handles.push(setInterval(async () => {
      try {
        const admitted = await QueueManager.processQueue();
        if (admitted.length > 0) {
          console.log(`[QueueProcessor] Admitted ${admitted.length} sessions`);
        }
      } catch (err) {
        console.error('[QueueProcessor] Queue error:', err);
      }
    }, PROCESS_INTERVAL_MS));

    // Token expiry: expire admitted sessions whose token TTL passed
    handles.push(setInterval(async () => {
      try {
        await this.cleanupExpiredTokens();
      } catch (err) {
        console.error('[QueueProcessor] Token cleanup error:', err);
      }
    }, TOKEN_EXPIRY_CLEANUP_MS));

    // Session GC: stale sessions that haven't been seen
    handles.push(setInterval(async () => {
      try {
        await this.garbageCollectSessions();
      } catch (err) {
        console.error('[QueueProcessor] GC error:', err);
      }
    }, SESSION_GC_MS));

    // Challenge enforcement
    handles.push(setInterval(async () => {
      try {
        await this.enforceChallenges();
      } catch (err) {
        console.error('[QueueProcessor] Challenge error:', err);
      }
    }, 10_000));

    // Position refresh for visible window
    handles.push(setInterval(async () => {
      try {
        await QueueManager.refreshPositions(50);
      } catch (err) {
        console.error('[QueueProcessor] Position refresh error:', err);
      }
    }, POSITION_REFRESH_MS));

    // Ban list cleanup
    handles.push(setInterval(async () => {
      try {
        await this.cleanupExpiredBans();
      } catch (err) {
        console.error('[QueueProcessor] Ban cleanup error:', err);
      }
    }, 120_000));

    // Periodic stats log
    handles.push(setInterval(async () => {
      try {
        const qLen = await redis.zcard('queueshield:queue');
        const admitted = await redis.hlen('queueshield:admitted');
        const expired = await prisma.session.count({ where: { status: 'EXPIRED' } });
        const banned = await prisma.session.count({ where: { isBanned: true } });
        const completed = await prisma.session.count({ where: { status: 'COMPLETED' } });
        console.log(`[QueueProcessor] Queue: ${qLen} | Admitted: ${admitted} | Expired: ${expired} | Banned: ${banned} | Completed: ${completed}`);
      } catch { /* ignore */ }
    }, STATS_LOG_MS));
  }

  static stop(): void {
    handles.forEach(h => clearInterval(h));
    handles.length = 0;
    isRunning = false;
    console.log('[QueueProcessor] Stopped');
  }

  private static async enforceChallenges(): Promise<void> {
    const thresholdMed = parseInt(process.env.RISK_THRESHOLD_MEDIUM || '60', 10);
    const thresholdHigh = parseInt(process.env.RISK_THRESHOLD_HIGH || '85', 10);

    // Challenge medium-risk sessions (batch)
    const suspects = await prisma.session.findMany({
      where: {
        status: 'IN_QUEUE',
        riskScore: { gte: thresholdMed, lt: thresholdHigh },
        isBanned: false,
      },
      select: { id: true, riskScore: true },
      take: 50,
    });

    for (const s of suspects) {
      const passed = await prisma.captchaAttempt.findFirst({
        where: { sessionId: s.id, passed: true },
      });
      if (!passed) {
        // For seeded sessions (no real browser), just remove them from queue
        // Real sessions would be redirected to /challenge/[sessionId]
        await QueueManager.removeFromQueue(s.id);
        await prisma.session.update({
          where: { id: s.id },
          data: { status: 'CHALLENGED' },
        });
      }
    }

    // Auto-ban high-risk (batch)
    const highRisk = await prisma.session.findMany({
      where: {
        status: { in: ['IN_QUEUE', 'CHALLENGED', 'ACTIVE'] },
        riskScore: { gte: thresholdHigh },
        isBanned: false,
      },
      select: { id: true, riskScore: true },
      take: 100,
    });

    for (const s of highRisk) {
      await SessionManager.banSession(s.id, `Auto-banned: risk score ${s.riskScore.toFixed(0)}`);
      await QueueManager.removeFromQueue(s.id);
    }

    if (highRisk.length > 0) {
      console.log(`[QueueProcessor] Banned ${highRisk.length} high-risk sessions`);
    }
    if (suspects.length > 0) {
      console.log(`[QueueProcessor] Challenged ${suspects.length} medium-risk sessions`);
    }
  }

  private static async cleanupExpiredTokens(): Promise<void> {
    // Bulk expire admitted sessions whose token has expired
    const result = await prisma.session.updateMany({
      where: {
        status: { in: ['ADMITTED', 'PURCHASING'] },
        accessTokenExpiresAt: { lt: new Date() },
      },
      data: { status: 'EXPIRED', accessToken: null },
    });

    if (result.count > 0) {
      // Also clean Redis admitted set for these
      const expired = await prisma.session.findMany({
        where: { status: 'EXPIRED', accessToken: null },
        select: { id: true },
        take: 500,
      });
      const pipe = redis.pipeline();
      for (const s of expired) {
        pipe.hdel('queueshield:admitted', s.id);
      }
      await pipe.exec();
      console.log(`[QueueProcessor] Expired ${result.count} tokens`);
    }
  }

  private static async garbageCollectSessions(): Promise<void> {
    // Sessions not seen for 2 minutes are stale (seeded sessions won't update lastSeenAt)
    const staleThreshold = new Date(Date.now() - 2 * 60 * 1000);

    // First, get IDs of stale IN_QUEUE sessions to remove from Redis
    const staleSessions = await prisma.session.findMany({
      where: {
        status: { in: ['IN_QUEUE', 'CHALLENGED'] },
        lastSeenAt: { lt: staleThreshold },
      },
      select: { id: true },
      take: 500,
    });

    if (staleSessions.length > 0) {
      // Remove from Redis queue
      const pipe = redis.pipeline();
      for (const s of staleSessions) {
        pipe.zrem('queueshield:queue', s.id);
        pipe.hdel('queueshield:positions', s.id);
      }
      await pipe.exec();

      // Mark expired in DB
      await prisma.session.updateMany({
        where: { id: { in: staleSessions.map((s: { id: string }) => s.id) } },
        data: { status: 'EXPIRED' },
      });

      console.log(`[QueueProcessor] GC'd ${staleSessions.length} stale sessions`);
    }

    // Also GC ACTIVE sessions not seen for 5 min
    const activeStale = new Date(Date.now() - 5 * 60 * 1000);
    const staleActive = await prisma.session.updateMany({
      where: {
        status: 'ACTIVE',
        lastSeenAt: { lt: activeStale },
      },
      data: { status: 'EXPIRED' },
    });
    if (staleActive.count > 0) {
      console.log(`[QueueProcessor] GC'd ${staleActive.count} stale ACTIVE sessions`);
    }
  }

  private static async cleanupExpiredBans(): Promise<void> {
    const result = await prisma.banList.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (result.count > 0) {
      console.log(`[QueueProcessor] Removed ${result.count} expired bans`);
    }
  }
}
