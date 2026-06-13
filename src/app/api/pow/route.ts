import { NextResponse } from 'next/server';
import { generateChallenge } from '@/lib/pow';
import { issueJsSeed } from '@/lib/js-challenge';

export const dynamic = 'force-dynamic';

/**
 * GET /api/pow — Issue a new Proof-of-Work challenge plus a single-use seed for
 * the Level-0 JS challenge. The client must solve both before joining the queue.
 */
export async function GET() {
  const challenge = generateChallenge();
  const jsSeed = await issueJsSeed();
  return NextResponse.json(
    { ...challenge, jsSeed },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    },
  );
}
