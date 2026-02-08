import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { prisma } from '@/lib/db';

const QUEUE_KEY = 'queueshield:queue';
const QUEUE_POSITIONS_KEY = 'queueshield:positions';

export const dynamic = 'force-dynamic';

/**
 * DELIBERATELY VULNERABLE ENDPOINT
 *
 * This endpoint allows reading and modifying queue position.
 * The "vulnerability" is that it only validates the queueToken
 * (which is visible in the page source / DOM) and doesn't require
 * admin authentication. An attacker who extracts the queueToken
 * from the page can manipulate their position.
 *
 * GET  /api/queue/position?sessionId=xxx&queueToken=xxx  → read position
 * PATCH /api/queue/position { sessionId, queueToken, position } → set position
 */

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  const queueToken = req.nextUrl.searchParams.get('queueToken');

  if (!sessionId || !queueToken) {
    return NextResponse.json({ error: 'Missing sessionId or queueToken' }, { status: 400 });
  }

  // "Validation" — only checks queue token (extractable from page source)
  const stored = await redis.hget(QUEUE_POSITIONS_KEY, sessionId);
  if (!stored) {
    return NextResponse.json({ error: 'Session not in queue' }, { status: 404 });
  }

  const data = JSON.parse(stored);
  if (data.queueToken !== queueToken) {
    return NextResponse.json({ error: 'Invalid queue token' }, { status: 403 });
  }

  const position = await redis.zrank(QUEUE_KEY, sessionId);
  const total = await redis.zcard(QUEUE_KEY);

  return NextResponse.json({
    sessionId,
    position: position !== null ? position + 1 : null,
    totalInQueue: total,
  });
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { sessionId, queueToken, position } = body;

    if (!sessionId || !queueToken) {
      return NextResponse.json({ error: 'Missing sessionId or queueToken' }, { status: 400 });
    }

    // "Validation" — only checks queue token (the vulnerability: token is in page source)
    const stored = await redis.hget(QUEUE_POSITIONS_KEY, sessionId);
    if (!stored) {
      return NextResponse.json({ error: 'Session not in queue' }, { status: 404 });
    }

    const data = JSON.parse(stored);
    if (data.queueToken !== queueToken) {
      return NextResponse.json({ error: 'Invalid queue token' }, { status: 403 });
    }

    // THE VULNERABILITY: allows setting arbitrary position by changing the sorted set score.
    // Position 1 = front of queue. We set the score to (desiredPosition - 1) so it sorts
    // before everyone else. Score 0 = absolute front.
    const desiredPosition = Math.max(1, parseInt(position, 10) || 1);
    const newScore = desiredPosition - 1; // score 0 = first in queue

    await redis.zadd(QUEUE_KEY, newScore, sessionId);

    // Update DB position
    await prisma.session.update({
      where: { id: sessionId },
      data: { queuePosition: desiredPosition },
    });

    const actualRank = await redis.zrank(QUEUE_KEY, sessionId);
    const total = await redis.zcard(QUEUE_KEY);

    return NextResponse.json({
      success: true,
      sessionId,
      previousData: data,
      newPosition: actualRank !== null ? actualRank + 1 : desiredPosition,
      totalInQueue: total,
    });
  } catch (err) {
    console.error('Position update error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
