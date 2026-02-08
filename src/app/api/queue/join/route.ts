import { NextRequest, NextResponse } from 'next/server';
import { SessionManager } from '@/lib/session-manager';
import { QueueManager } from '@/lib/queue-manager';
import { BotDetector } from '@/lib/bot-detector';
import { RateLimiter } from '@/lib/rate-limiter';
import { initializeServer } from '@/lib/init';
import { verifyRecaptcha, recaptchaScoreToRisk } from '@/lib/recaptcha';
import { verifySolution as verifyPoW } from '@/lib/pow';
import { verifyJsChallenge } from '@/lib/crypto';
import { analyzeIp } from '@/lib/ip-intelligence';

export async function POST(req: NextRequest) {
  // Start background queue processor on first join
  initializeServer();
  try {
    const body = await req.json();
    const { eventId, jsChallenge, pow, recaptchaToken } = body;

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

    // --- Layer 0: JavaScript challenge verification ---
    if (jsChallenge?.seed && jsChallenge?.answer) {
      const jsValid = verifyJsChallenge(jsChallenge.seed, jsChallenge.answer);
      if (!jsValid) {
        return NextResponse.json(
          { error: 'Browser verification failed.' },
          { status: 403 },
        );
      }
    }

    // --- Layer 1: Proof-of-Work verification ---
    if (pow?.challenge && pow?.nonce) {
      const powResult = await verifyPoW(pow.challenge, pow.nonce, pow.difficulty || 18);
      if (!powResult.valid) {
        return NextResponse.json(
          { error: `Security challenge failed: ${powResult.reason}` },
          { status: 403 },
        );
      }
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

    // --- Layer 2: Passive header analysis ---
    const passiveResult = await BotDetector.performPassiveAnalysis(sessionId, hdrs, ip);

    // --- Layer 3: IP intelligence ---
    const ipIntel = analyzeIp(ip, hdrs);
    if (ipIntel.riskScore > 0) {
      await SessionManager.addBotScore(sessionId, 'passive', 'ip_intelligence', ipIntel.riskScore, {
        isDatacenter: ipIntel.isDatacenter,
        isProxy: ipIntel.isProxy,
        isTor: ipIntel.isTor,
        provider: ipIntel.provider,
        flags: ipIntel.flags,
      });
    }

    // --- Layer 4: reCAPTCHA v3 verification (invisible) ---
    if (recaptchaToken) {
      const recaptchaResult = await verifyRecaptcha(recaptchaToken, 'join_queue');
      const recaptchaRisk = recaptchaScoreToRisk(recaptchaResult.score);
      await SessionManager.addBotScore(sessionId, 'active', 'recaptcha_v3', recaptchaRisk, {
        score: recaptchaResult.score,
        success: recaptchaResult.success,
        action: recaptchaResult.action,
        hostname: recaptchaResult.hostname,
      });
    }

    // --- Layer 5: Device deduplication ---
    const existingSession = await SessionManager.findActiveSessionByIp(ip);
    if (existingSession) {
      await SessionManager.addBotScore(sessionId, 'passive', 'duplicate_ip', 15, {
        existingSessionId: existingSession,
      });
    }

    // Re-check aggregate risk after all layers
    const session = await SessionManager.getSession(sessionId);
    if (session && session.riskScore >= 90) {
      await SessionManager.banSession(sessionId, 'Critical risk score from multi-layer analysis');
      return NextResponse.json(
        { error: 'Access denied.' },
        { status: 403 },
      );
    }

    // Join the queue
    const { queueToken, tokenSignature, position } = await QueueManager.joinQueue(sessionId);

    return NextResponse.json({
      sessionId,
      queueToken,
      tokenSignature,
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
