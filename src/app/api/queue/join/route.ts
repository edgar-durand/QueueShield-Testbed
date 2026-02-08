import { NextRequest, NextResponse } from 'next/server';
import { SessionManager } from '@/lib/session-manager';
import { QueueManager } from '@/lib/queue-manager';
import { BotDetector } from '@/lib/bot-detector';
import { RateLimiter } from '@/lib/rate-limiter';
import { initializeServer } from '@/lib/init';

export async function POST(req: NextRequest) {
  // Start background queue processor on first join
  initializeServer();
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('x-real-ip')
      || '127.0.0.1';

    // Rate limit
    const { QUEUE_JOIN } = RateLimiter.PROFILES;
    const rl = await RateLimiter.check(`join:${ip}`, QUEUE_JOIN.limit, QUEUE_JOIN.windowSeconds);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait before trying again.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
      );
    }

    // Check IP ban
    const isBanned = await SessionManager.isIpBanned(ip);
    if (isBanned) {
      return NextResponse.json(
        { error: 'Access denied. Your IP has been temporarily banned.' },
        { status: 403 },
      );
    }

    const ua = req.headers.get('user-agent') || '';

    // Collect headers for passive fingerprinting
    const hdrs: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      hdrs[key] = value;
    });

    // Create session
    const sessionId = await SessionManager.createSession({
      ipAddress: ip,
      userAgent: ua,
      headers: hdrs,
    });

    // Perform passive analysis (Level 1)
    const passiveResult = await BotDetector.performPassiveAnalysis(sessionId, hdrs, ip);

    // If risk is critical from passive analysis alone, reject immediately
    if (passiveResult.totalScore >= 90) {
      await SessionManager.banSession(sessionId, 'Critical risk score from passive analysis');
      return NextResponse.json(
        { error: 'Access denied.' },
        { status: 403 },
      );
    }

    // Join the queue
    const { queueToken, position } = await QueueManager.joinQueue(sessionId);

    return NextResponse.json({
      sessionId,
      queueToken,
      position,
      message: `You are #${position} in the queue`,
    });
  } catch (err) {
    console.error('Queue join error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
