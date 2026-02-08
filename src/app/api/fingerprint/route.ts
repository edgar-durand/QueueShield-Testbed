import { NextRequest, NextResponse } from 'next/server';
import { BotDetector } from '@/lib/bot-detector';
import { SessionManager } from '@/lib/session-manager';
import { generateDeviceHash } from '@/lib/crypto';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sessionId, deviceHash: clientDeviceHash, ...fingerprintData } = body;

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    // Analyze active fingerprint (Level 2)
    const score = await BotDetector.analyzeActiveFingerprint(sessionId, fingerprintData);

    // Compute server-side device hash for dedup (don't trust client hash alone)
    const serverDeviceHash = generateDeviceHash(fingerprintData);
    await SessionManager.setDeviceFingerprint(sessionId, serverDeviceHash);

    // Check for device deduplication — same device in another active session
    const existingSession = await SessionManager.findActiveSessionByFingerprint(serverDeviceHash);
    if (existingSession && existingSession !== sessionId) {
      await SessionManager.addBotScore(sessionId, 'active', 'duplicate_device', 25, {
        existingSessionId: existingSession,
        deviceHash: serverDeviceHash.slice(0, 16),
      });
    }

    return NextResponse.json({ score, received: true });
  } catch (err) {
    console.error('Fingerprint API error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
