import { NextRequest, NextResponse } from 'next/server';
import { BotDetector } from '@/lib/bot-detector';
import { prisma } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sessionId, mouseEvents, clickEvents, keyEvents, scrollEvents } = body;

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    // Store raw telemetry
    if (mouseEvents?.length > 0) {
      await prisma.telemetryEvent.create({
        data: { sessionId, eventType: 'mouse_move', data: mouseEvents },
      });
    }
    if (clickEvents?.length > 0) {
      await prisma.telemetryEvent.create({
        data: { sessionId, eventType: 'mouse_click', data: clickEvents },
      });
    }
    if (keyEvents?.length > 0) {
      await prisma.telemetryEvent.create({
        data: { sessionId, eventType: 'key_press', data: keyEvents },
      });
    }

    // Analyze behavior
    const score = await BotDetector.analyzeBehavior(sessionId, {
      mouseEvents,
      clickEvents,
      keyEvents,
      scrollEvents,
    });

    return NextResponse.json({ score, received: true });
  } catch (err) {
    console.error('Telemetry API error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
