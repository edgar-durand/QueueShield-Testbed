import { NextResponse } from 'next/server';
import { generateChallenge } from '@/lib/pow';

export const dynamic = 'force-dynamic';

/**
 * GET /api/pow — Issue a new Proof-of-Work challenge.
 * The client must solve this before joining the queue.
 */
export async function GET() {
  const challenge = generateChallenge();
  return NextResponse.json(challenge, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
