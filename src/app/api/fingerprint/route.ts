import { NextRequest, NextResponse } from 'next/server';
import { BotDetector } from '@/lib/bot-detector';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sessionId, ...fingerprintData } = body;

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    const score = await BotDetector.analyzeActiveFingerprint(sessionId, fingerprintData);

    return NextResponse.json({ score, received: true });
  } catch (err) {
    console.error('Fingerprint API error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
