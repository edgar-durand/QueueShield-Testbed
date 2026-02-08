import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { redis } from '@/lib/redis';

/**
 * GET /api/health — Health check endpoint for load balancers and monitoring.
 */
export async function GET() {
  const checks: Record<string, { ok: boolean; latencyMs: number; error?: string }> = {};

  // Database check
  const dbStart = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { ok: true, latencyMs: Date.now() - dbStart };
  } catch (err) {
    checks.database = { ok: false, latencyMs: Date.now() - dbStart, error: String(err) };
  }

  // Redis check
  const redisStart = Date.now();
  try {
    await redis.ping();
    checks.redis = { ok: true, latencyMs: Date.now() - redisStart };
  } catch (err) {
    checks.redis = { ok: false, latencyMs: Date.now() - redisStart, error: String(err) };
  }

  const allHealthy = Object.values(checks).every(c => c.ok);

  return NextResponse.json(
    {
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks,
    },
    { status: allHealthy ? 200 : 503 },
  );
}
