import { NextRequest, NextResponse } from 'next/server';
import { QueueManager } from '@/lib/queue-manager';

export async function POST(req: NextRequest) {
  try {
    const { token, sessionId } = await req.json();

    if (!token || !sessionId) {
      return NextResponse.json({ error: 'Missing token or sessionId' }, { status: 400 });
    }

    const validation = await QueueManager.validateAccessToken(token);
    if (!validation.valid) {
      return NextResponse.json({ error: 'Invalid or expired access token' }, { status: 403 });
    }

    if (validation.sessionId !== sessionId) {
      return NextResponse.json({ error: 'Token/session mismatch' }, { status: 403 });
    }

    const success = await QueueManager.completePurchase(sessionId);
    if (!success) {
      return NextResponse.json({ error: 'Purchase failed' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Purchase completed!' });
  } catch (err) {
    console.error('Purchase error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
