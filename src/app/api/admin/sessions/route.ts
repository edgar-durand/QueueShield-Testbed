import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { redis } from '@/lib/redis';
import { QueueManager } from '@/lib/queue-manager';
import { SessionManager } from '@/lib/session-manager';
import { validateBasicAuth, verifyAdminToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function authenticateAdmin(req: NextRequest): Promise<boolean> {
  const auth = req.headers.get('authorization');
  if (!auth) return false;
  if (auth.startsWith('Bearer ')) {
    return verifyAdminToken(auth.slice(7));
  }
  if (auth.startsWith('Basic ')) {
    return validateBasicAuth(auth);
  }
  return false;
}

export async function GET(req: NextRequest) {
  if (!(await authenticateAdmin(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const status = req.nextUrl.searchParams.get('status');
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '50', 10);

  const where: Record<string, unknown> = {};
  if (status) where.status = status;

  const sessions = await prisma.session.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      botScores: { orderBy: { createdAt: 'desc' }, take: 5 },
      captchaAttempts: { orderBy: { createdAt: 'desc' }, take: 3 },
      _count: { select: { telemetryEvents: true } },
    },
  });

  const queueLength = await QueueManager.getQueueLength();
  const admittedCount = await QueueManager.getAdmittedCount();

  const totalSessions = await prisma.session.count();
  const bannedSessions = await prisma.session.count({ where: { isBanned: true } });
  const completedSessions = await prisma.session.count({ where: { status: 'COMPLETED' } });

  return NextResponse.json({
    sessions,
    stats: {
      totalSessions,
      queueLength,
      admittedCount,
      bannedSessions,
      completedSessions,
    },
  });
}

export async function POST(req: NextRequest) {
  if (!(await authenticateAdmin(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { action, sessionId, reason } = await req.json();

  if (!sessionId) {
    return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
  }

  switch (action) {
    case 'ban':
      await SessionManager.banSession(sessionId, reason || 'Banned by admin');
      await QueueManager.removeFromQueue(sessionId);
      return NextResponse.json({ success: true, message: 'Session banned' });

    case 'unban':
      await prisma.session.update({
        where: { id: sessionId },
        data: { isBanned: false, banReason: null, status: 'EXPIRED' },
      });
      return NextResponse.json({ success: true, message: 'Session unbanned' });

    case 'remove':
      await QueueManager.removeFromQueue(sessionId);
      await prisma.session.update({
        where: { id: sessionId },
        data: { status: 'EXPIRED' },
      });
      return NextResponse.json({ success: true, message: 'Session removed from queue' });

    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await authenticateAdmin(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Purge all data from DB (children first, then sessions)
  const [botScores, captcha, telemetry, bans, sessions] = await prisma.$transaction([
    prisma.botScore.deleteMany(),
    prisma.captchaAttempt.deleteMany(),
    prisma.telemetryEvent.deleteMany(),
    prisma.banList.deleteMany(),
    prisma.session.deleteMany(),
  ]);

  // Flush Redis queue keys
  await redis.del('queueshield:queue', 'queueshield:positions', 'queueshield:admitted');

  return NextResponse.json({
    success: true,
    purged: {
      sessions: sessions.count,
      botScores: botScores.count,
      captchaAttempts: captcha.count,
      telemetryEvents: telemetry.count,
      bans: bans.count,
    },
  });
}
