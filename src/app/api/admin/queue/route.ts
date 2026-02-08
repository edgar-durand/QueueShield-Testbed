import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { redis } from '@/lib/redis';
import { v4 as uuidv4 } from 'uuid';
import { validateBasicAuth, verifyAdminToken } from '@/lib/auth';
import { initializeServer } from '@/lib/init';

const QUEUE_KEY = 'queueshield:queue';
const QUEUE_POSITIONS_KEY = 'queueshield:positions';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'python-requests/2.31.0',
  'HeadlessChrome/120.0.0.0',
  'node-fetch/1.0',
];

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randomIp() {
  return `${rand(1, 223)}.${rand(0, 255)}.${rand(0, 255)}.${rand(1, 254)}`;
}

async function authenticate(req: NextRequest): Promise<boolean> {
  const auth = req.headers.get('authorization');
  if (!auth) return false;
  if (auth.startsWith('Bearer ')) return verifyAdminToken(auth.slice(7));
  if (auth.startsWith('Basic ')) return validateBasicAuth(auth);
  return false;
}

export async function POST(req: NextRequest) {
  if (!(await authenticate(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Start queue processor when admin adds users
  initializeServer();

  try {
    const { count } = await req.json();
    const total = Math.min(Math.max(parseInt(count, 10) || 0, 1), 50_000);

    const BATCH = 500;
    let created = 0;
    const startTime = Date.now();

    // Get current queue size to stagger timestamps after existing entries
    const currentSize = await redis.zcard(QUEUE_KEY);
    const baseTime = Date.now();

    for (let batch = 0; batch < Math.ceil(total / BATCH); batch++) {
      const batchStart = batch * BATCH;
      const batchEnd = Math.min(batchStart + BATCH, total);
      const batchCount = batchEnd - batchStart;

      const sessions: Array<{
        id: string;
        ipAddress: string;
        userAgent: string;
        status: 'IN_QUEUE';
        riskScore: number;
        riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
        queueToken: string;
        queuePosition: number;
        queueJoinedAt: Date;
        lastSeenAt: Date;
      }> = [];

      const pipe = redis.pipeline();

      for (let i = 0; i < batchCount; i++) {
        const globalIdx = batchStart + i;
        const id = uuidv4();
        const queueToken = uuidv4();
        const joinedAt = baseTime + globalIdx; // 1ms apart

        // Risk distribution: 70% low, 15% medium, 10% high, 5% critical
        const r = Math.random();
        let riskScore: number;
        let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
        if (r < 0.70) { riskScore = rand(0, 29); riskLevel = 'LOW'; }
        else if (r < 0.85) { riskScore = rand(30, 59); riskLevel = 'MEDIUM'; }
        else if (r < 0.95) { riskScore = rand(60, 84); riskLevel = 'HIGH'; }
        else { riskScore = rand(85, 100); riskLevel = 'CRITICAL'; }

        sessions.push({
          id,
          ipAddress: randomIp(),
          userAgent: pick(USER_AGENTS),
          status: 'IN_QUEUE',
          riskScore,
          riskLevel,
          queueToken,
          queuePosition: currentSize + globalIdx + 1,
          queueJoinedAt: new Date(joinedAt),
          lastSeenAt: new Date(joinedAt + rand(0, 5000)),
        });

        pipe.zadd(QUEUE_KEY, joinedAt, id);
        pipe.hset(QUEUE_POSITIONS_KEY, id, JSON.stringify({ queueToken, joinedAt }));
      }

      await prisma.session.createMany({ data: sessions });

      // Bot scores for non-LOW
      const botScores: Array<{ sessionId: string; layer: string; category: string; score: number }> = [];
      for (const s of sessions) {
        if (s.riskLevel === 'LOW') continue;
        botScores.push({
          sessionId: s.id,
          layer: 'passive',
          category: pick(['user_agent_pattern', 'missing_headers', 'header_order']),
          score: Math.min(100, s.riskScore * (0.3 + Math.random() * 0.4)),
        });
        if (s.riskLevel === 'HIGH' || s.riskLevel === 'CRITICAL') {
          botScores.push({
            sessionId: s.id,
            layer: 'behavior',
            category: pick(['mouse_linearity', 'keystroke_uniformity', 'zero_mouse_movement']),
            score: Math.min(100, s.riskScore * (0.5 + Math.random() * 0.5)),
          });
        }
      }
      if (botScores.length > 0) {
        await prisma.botScore.createMany({ data: botScores });
      }

      await pipe.exec();
      created += batchCount;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const newQueueSize = await redis.zcard(QUEUE_KEY);

    return NextResponse.json({
      success: true,
      created,
      queueSize: newQueueSize,
      elapsed: `${elapsed}s`,
    });
  } catch (err) {
    console.error('Bulk add error:', err);
    return NextResponse.json({ error: 'Failed to add users' }, { status: 500 });
  }
}
