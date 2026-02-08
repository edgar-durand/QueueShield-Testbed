import { prisma } from './db';
import { v4 as uuidv4 } from 'uuid';
import { headers } from 'next/headers';
import type { SessionStatus, RiskLevel } from '@prisma/client';

export interface CreateSessionInput {
  ipAddress: string;
  userAgent: string;
  headers: Record<string, string>;
}

export class SessionManager {
  static async createSession(input: CreateSessionInput): Promise<string> {
    const session = await prisma.session.create({
      data: {
        id: uuidv4(),
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        passiveFingerprint: input.headers,
        status: 'ACTIVE',
      },
    });
    return session.id;
  }

  static async getSession(sessionId: string) {
    return prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        botScores: { orderBy: { createdAt: 'desc' }, take: 20 },
        captchaAttempts: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });
  }

  static async updateRiskScore(sessionId: string, score: number): Promise<void> {
    const thresholdLow = parseInt(process.env.RISK_THRESHOLD_LOW || '30', 10);
    const thresholdMed = parseInt(process.env.RISK_THRESHOLD_MEDIUM || '60', 10);
    const thresholdHigh = parseInt(process.env.RISK_THRESHOLD_HIGH || '85', 10);

    let riskLevel: RiskLevel = 'LOW';
    if (score >= thresholdHigh) riskLevel = 'CRITICAL';
    else if (score >= thresholdMed) riskLevel = 'HIGH';
    else if (score >= thresholdLow) riskLevel = 'MEDIUM';

    await prisma.session.update({
      where: { id: sessionId },
      data: {
        riskScore: score,
        riskLevel,
        lastSeenAt: new Date(),
      },
    });
  }

  static async banSession(sessionId: string, reason: string): Promise<void> {
    const session = await prisma.session.update({
      where: { id: sessionId },
      data: {
        isBanned: true,
        banReason: reason,
        status: 'BANNED',
      },
    });

    // Also ban the IP
    await prisma.banList.upsert({
      where: { ipAddress: session.ipAddress },
      create: {
        ipAddress: session.ipAddress,
        reason,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 min ban
      },
      update: {
        reason,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });
  }

  static async isIpBanned(ipAddress: string): Promise<boolean> {
    const ban = await prisma.banList.findUnique({
      where: { ipAddress },
    });
    if (!ban) return false;
    if (ban.expiresAt && ban.expiresAt < new Date()) {
      await prisma.banList.delete({ where: { ipAddress } });
      return false;
    }
    return true;
  }

  static async touchSession(sessionId: string): Promise<void> {
    await prisma.session.update({
      where: { id: sessionId },
      data: { lastSeenAt: new Date() },
    });
  }

  static async addBotScore(
    sessionId: string,
    layer: string,
    category: string,
    score: number,
    details?: Record<string, unknown>,
  ): Promise<void> {
    await prisma.botScore.create({
      data: {
        sessionId,
        layer,
        category,
        score,
        details: (details ?? undefined) as any,
      },
    });

    // Recalculate aggregate risk score
    const scores = await prisma.botScore.findMany({
      where: { sessionId },
      select: { score: true, layer: true },
    });

    // Weighted average: passive=1x, active=1.5x, behavior=2x, captcha=2.5x
    const weights: Record<string, number> = {
      passive: 1.0,
      active: 1.5,
      behavior: 2.0,
      captcha: 2.5,
    };

    let totalWeight = 0;
    let weightedSum = 0;
    for (const s of scores) {
      const w = weights[s.layer] || 1.0;
      weightedSum += s.score * w;
      totalWeight += w;
    }

    const aggregateScore = totalWeight > 0 ? Math.min(100, weightedSum / totalWeight) : 0;
    await this.updateRiskScore(sessionId, aggregateScore);
  }

  static getClientIp(): string {
    const hdrs = headers();
    return (
      hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      hdrs.get('x-real-ip') ||
      '127.0.0.1'
    );
  }

  static getClientHeaders(): Record<string, string> {
    const hdrs = headers();
    const result: Record<string, string> = {};
    hdrs.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
}
