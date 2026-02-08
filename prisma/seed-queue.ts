import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import Redis from 'ioredis';

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6380', {
  maxRetriesPerRequest: 3,
});

const QUEUE_KEY = 'queueshield:queue';
const QUEUE_POSITIONS_KEY = 'queueshield:positions';

const TOTAL_USERS = 10_000;
const BATCH_SIZE = 500;

// Realistic user-agent pool
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0',
  // Some suspicious/bot-like UAs (~10% of pool)
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'python-requests/2.31.0',
  'axios/1.6.2',
  'node-fetch/1.0',
  'HeadlessChrome/120.0.0.0',
];

const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

function randomIp(): string {
  // Mix of realistic IP ranges
  const ranges = [
    () => `${rand(1, 223)}.${rand(0, 255)}.${rand(0, 255)}.${rand(1, 254)}`,  // public
    () => `192.168.${rand(0, 255)}.${rand(1, 254)}`,                            // private (NAT)
    () => `10.${rand(0, 255)}.${rand(0, 255)}.${rand(1, 254)}`,                 // private
    () => `172.${rand(16, 31)}.${rand(0, 255)}.${rand(1, 254)}`,                // private
  ];
  // 80% public, 20% private (to simulate proxied users)
  return Math.random() < 0.8 ? ranges[0]() : ranges[rand(1, 3)]();
}

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateRiskScore(): { score: number; level: typeof RISK_LEVELS[number] } {
  // Distribution: 70% low, 15% medium, 10% high, 5% critical
  const r = Math.random();
  if (r < 0.70) return { score: rand(0, 29), level: 'LOW' };
  if (r < 0.85) return { score: rand(30, 59), level: 'MEDIUM' };
  if (r < 0.95) return { score: rand(60, 84), level: 'HIGH' };
  return { score: rand(85, 100), level: 'CRITICAL' };
}

async function main() {
  console.log(`\nSeeding ${TOTAL_USERS.toLocaleString()} users into the queue...\n`);

  // Clear existing queue data
  console.log('  Clearing existing queue data...');
  await redis.del(QUEUE_KEY);
  await redis.del(QUEUE_POSITIONS_KEY);
  await prisma.telemetryEvent.deleteMany();
  await prisma.captchaAttempt.deleteMany();
  await prisma.botScore.deleteMany();
  await prisma.session.deleteMany();
  console.log('  Done.\n');

  const startTime = Date.now();
  let created = 0;

  for (let batch = 0; batch < Math.ceil(TOTAL_USERS / BATCH_SIZE); batch++) {
    const batchStart = batch * BATCH_SIZE;
    const batchEnd = Math.min(batchStart + BATCH_SIZE, TOTAL_USERS);
    const batchCount = batchEnd - batchStart;

    // Prepare session records
    const sessions: Array<{
      id: string;
      ipAddress: string;
      userAgent: string;
      status: 'IN_QUEUE';
      riskScore: number;
      riskLevel: typeof RISK_LEVELS[number];
      queueToken: string;
      queuePosition: number;
      queueJoinedAt: Date;
      lastSeenAt: Date;
    }> = [];

    const redisPipeline = redis.pipeline();

    for (let i = 0; i < batchCount; i++) {
      const globalIndex = batchStart + i;
      const id = uuidv4();
      const queueToken = uuidv4();
      const ip = randomIp();
      const ua = pick(USER_AGENTS);
      const { score, level } = generateRiskScore();

      // Stagger join times: 1 user every ~50ms across a simulated 8-minute window
      const joinedAt = startTime - (TOTAL_USERS - globalIndex) * 50;
      const lastSeen = joinedAt + rand(0, 30_000); // last seen 0-30s after join

      sessions.push({
        id,
        ipAddress: ip,
        userAgent: ua,
        status: 'IN_QUEUE',
        riskScore: score,
        riskLevel: level,
        queueToken,
        queuePosition: globalIndex + 1,
        queueJoinedAt: new Date(joinedAt),
        lastSeenAt: new Date(lastSeen),
      });

      // Queue in Redis sorted set (score = joinedAt for FIFO)
      redisPipeline.zadd(QUEUE_KEY, joinedAt, id);
      redisPipeline.hset(QUEUE_POSITIONS_KEY, id, JSON.stringify({
        queueToken,
        joinedAt,
      }));
    }

    // Bulk insert sessions into Postgres
    await prisma.session.createMany({ data: sessions });

    // Bulk insert bot scores for non-LOW risk sessions
    const botScores: Array<{
      sessionId: string;
      layer: string;
      category: string;
      score: number;
    }> = [];

    for (const s of sessions) {
      if (s.riskLevel === 'LOW') continue;

      // Passive layer score
      botScores.push({
        sessionId: s.id,
        layer: 'passive',
        category: pick(['user_agent_pattern', 'missing_headers', 'header_order', 'ip_reputation']),
        score: Math.min(100, s.riskScore * (0.3 + Math.random() * 0.4)),
      });

      // Active layer score (always present for non-LOW)
      botScores.push({
        sessionId: s.id,
        layer: 'active',
        category: pick(['canvas_hash', 'webgl_renderer', 'webdriver_detected', 'automation_flags', 'plugin_count']),
        score: Math.min(100, s.riskScore * (0.2 + Math.random() * 0.5)),
      });

      // Behavior layer for HIGH/CRITICAL
      if (s.riskLevel === 'HIGH' || s.riskLevel === 'CRITICAL') {
        botScores.push({
          sessionId: s.id,
          layer: 'behavior',
          category: pick(['mouse_linearity', 'keystroke_uniformity', 'rage_clicks', 'zero_mouse_movement']),
          score: Math.min(100, s.riskScore * (0.5 + Math.random() * 0.5)),
        });
      }
    }

    if (botScores.length > 0) {
      await prisma.botScore.createMany({ data: botScores });
    }

    // Execute Redis pipeline
    await redisPipeline.exec();

    created += batchCount;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const pct = ((created / TOTAL_USERS) * 100).toFixed(0);
    process.stdout.write(`\r  Progress: ${created.toLocaleString()} / ${TOTAL_USERS.toLocaleString()} (${pct}%) — ${elapsed}s`);
  }

  // Summary stats
  const totalSessions = await prisma.session.count();
  const queueLength = await redis.zcard(QUEUE_KEY);
  const totalBotScores = await prisma.botScore.count();

  const lowCount = await prisma.session.count({ where: { riskLevel: 'LOW' } });
  const medCount = await prisma.session.count({ where: { riskLevel: 'MEDIUM' } });
  const highCount = await prisma.session.count({ where: { riskLevel: 'HIGH' } });
  const critCount = await prisma.session.count({ where: { riskLevel: 'CRITICAL' } });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n\n  Seed complete in ${elapsed}s`);
  console.log(`  ────────────────────────────────`);
  console.log(`  Sessions created:  ${totalSessions.toLocaleString()}`);
  console.log(`  Redis queue size:  ${queueLength.toLocaleString()}`);
  console.log(`  Bot scores:        ${totalBotScores.toLocaleString()}`);
  console.log(`  ────────────────────────────────`);
  console.log(`  Risk distribution:`);
  console.log(`    LOW:      ${lowCount.toLocaleString()} (${((lowCount / totalSessions) * 100).toFixed(1)}%)`);
  console.log(`    MEDIUM:   ${medCount.toLocaleString()} (${((medCount / totalSessions) * 100).toFixed(1)}%)`);
  console.log(`    HIGH:     ${highCount.toLocaleString()} (${((highCount / totalSessions) * 100).toFixed(1)}%)`);
  console.log(`    CRITICAL: ${critCount.toLocaleString()} (${((critCount / totalSessions) * 100).toFixed(1)}%)`);
  console.log('');
}

main()
  .catch((e) => {
    console.error('\nSeed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await redis.quit();
  });
