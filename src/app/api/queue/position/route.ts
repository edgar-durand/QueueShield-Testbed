import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';

const QUEUE_KEY = 'queueshield:queue';
const QUEUE_POSITIONS_KEY = 'queueshield:positions';

export const dynamic = 'force-dynamic';

/**
 * GET /api/queue/position?sessionId=xxx — read queue position.
 * Protected by session ownership cookie.
 */
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId');

  if (!sessionId) {
    return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
  }

  // Session ownership: validate cookie
  const ownerCookie = req.cookies.get('qs_session')?.value;
  if (!ownerCookie || ownerCookie !== sessionId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const stored = await redis.hget(QUEUE_POSITIONS_KEY, sessionId);
  if (!stored) {
    return NextResponse.json({ error: 'Session not in queue' }, { status: 404 });
  }

  const position = await redis.zrank(QUEUE_KEY, sessionId);
  const total = await redis.zcard(QUEUE_KEY);

  return NextResponse.json({
    sessionId,
    position: position !== null ? position + 1 : null,
    totalInQueue: total,
  });
}
