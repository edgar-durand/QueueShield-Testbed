import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { SessionManager } from '@/lib/session-manager';
import { RateLimiter } from '@/lib/rate-limiter';

export async function POST(req: NextRequest) {
  try {
    const { sessionId, response, type } = await req.json();

    if (!sessionId || !response) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    // Rate limit
    const rl = await RateLimiter.check(`captcha:${sessionId}`, 10, 60);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many attempts' }, { status: 429 });
    }

    let passed = false;
    let responseTimeMs = 0;

    if (type === 'recaptcha') {
      // Verify with Google reCAPTCHA v3
      const { verifyRecaptcha } = await import('@/lib/recaptcha');
      const result = await verifyRecaptcha(response, 'captcha_challenge');
      passed = result.success && result.score >= 0.5;
      responseTimeMs = 0;
    } else if (type === 'custom_click' || type === 'custom_drag') {
      // Verify custom challenge
      try {
        const data = JSON.parse(response);
        responseTimeMs = data.elapsed || 0;

        if (type === 'custom_click') {
          passed = data.correct === true;
          // Suspiciously fast response = bot
          if (responseTimeMs < 500) {
            passed = false;
          }
        } else if (type === 'custom_drag') {
          passed = data.correct === true;
          // Must have some mouse movement events
          if (data.moveCount < 5 || responseTimeMs < 800) {
            passed = false;
          }
        }
      } catch {
        passed = false;
      }
    }

    // Record attempt
    await prisma.captchaAttempt.create({
      data: {
        sessionId,
        provider: type === 'recaptcha' ? 'recaptcha' : 'custom',
        challengeType: type,
        passed,
        responseTime: responseTimeMs > 0 ? responseTimeMs : null,
      },
    });

    // Update bot score based on CAPTCHA result
    if (!passed) {
      await SessionManager.addBotScore(sessionId, 'captcha', 'failed_challenge', 40, {
        type,
        responseTimeMs,
      });
    } else {
      // Passed captcha reduces risk (negative score contribution)
      await SessionManager.addBotScore(sessionId, 'captcha', 'passed_challenge', -20, {
        type,
        responseTimeMs,
      });

      // Return to queue
      await prisma.session.update({
        where: { id: sessionId },
        data: { status: 'IN_QUEUE' },
      });
    }

    // Check if too many failed attempts -> ban
    const failedCount = await prisma.captchaAttempt.count({
      where: { sessionId, passed: false },
    });
    if (failedCount >= 5) {
      await SessionManager.banSession(sessionId, 'Too many failed CAPTCHA attempts');
      return NextResponse.json({
        passed: false,
        error: 'Too many failed attempts. Session terminated.',
        banned: true,
      });
    }

    return NextResponse.json({ passed });
  } catch (err) {
    console.error('CAPTCHA verify error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
