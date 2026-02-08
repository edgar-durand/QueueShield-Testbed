import { NextRequest } from 'next/server';
import { QueueManager } from '@/lib/queue-manager';
import { SessionManager } from '@/lib/session-manager';
import { RateLimiter } from '@/lib/rate-limiter';
import { initializeServer } from '@/lib/init';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Ensure background processor is running
initializeServer();

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  if (!sessionId) {
    return new Response('Missing sessionId', { status: 400 });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip') || '127.0.0.1';

  // Rate limit SSE connections
  const { SSE } = RateLimiter.PROFILES;
  const rl = await RateLimiter.check(`sse:${ip}`, SSE.limit, SSE.windowSeconds);
  if (!rl.allowed) {
    return new Response('Too many connections', { status: 429 });
  }

  // Validate session exists
  const session = await SessionManager.getSession(sessionId);
  if (!session) {
    return new Response('Invalid session', { status: 404 });
  }

  if (session.isBanned) {
    return new Response('Session banned', { status: 403 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch { /* stream closed */ }
      };

      let isOpen = true;

      // Send heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        if (!isOpen) return;
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch { isOpen = false; }
      }, 15_000);

      const interval = setInterval(async () => {
        if (!isOpen) {
          clearInterval(interval);
          clearInterval(heartbeat);
          return;
        }

        try {
          // Check if session was challenged (redirect to CAPTCHA)
          const currentSession = await prisma.session.findUnique({
            where: { id: sessionId },
            select: { status: true, isBanned: true },
          });

          if (!currentSession || currentSession.isBanned) {
            sendEvent('removed', { reason: 'Session banned' });
            isOpen = false;
            clearInterval(interval);
            clearInterval(heartbeat);
            try { controller.close(); } catch {}
            return;
          }

          if (currentSession.status === 'CHALLENGED') {
            sendEvent('challenge', { challengeUrl: `/challenge/${sessionId}` });
            return;
          }

          // Get current queue status (processing is done by QueueProcessor)
          const status = await QueueManager.getQueueStatus(sessionId);

          // Update last seen
          await SessionManager.touchSession(sessionId).catch(() => {});

          if (status.status === 'admitted') {
            sendEvent('admitted', {
              accessToken: status.accessToken,
              accessUrl: status.accessUrl,
            });
            setTimeout(() => {
              isOpen = false;
              clearInterval(interval);
              clearInterval(heartbeat);
              try { controller.close(); } catch {}
            }, 2000);
          } else if (status.status === 'removed') {
            sendEvent('removed', { reason: 'Session removed from queue' });
            isOpen = false;
            clearInterval(interval);
            clearInterval(heartbeat);
            try { controller.close(); } catch {}
          } else {
            sendEvent('position', {
              position: status.position,
              totalInQueue: status.totalInQueue,
              estimatedWaitSeconds: status.estimatedWaitSeconds,
            });
          }
        } catch (err) {
          console.error('SSE error:', err);
        }
      }, 2000);

      // Send initial position
      try {
        const initialStatus = await QueueManager.getQueueStatus(sessionId);
        sendEvent('position', {
          position: initialStatus.position,
          totalInQueue: initialStatus.totalInQueue,
          estimatedWaitSeconds: initialStatus.estimatedWaitSeconds,
        });
      } catch {
        // Ignore initial error
      }

      // Cleanup on abort
      req.signal.addEventListener('abort', () => {
        isOpen = false;
        clearInterval(interval);
        clearInterval(heartbeat);
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
