/**
 * Proof-of-Work challenge system.
 * Browser must find a nonce where SHA-256(challenge + nonce) starts with N zero bits.
 * This adds computational cost to joining the queue, deterring mass bot registrations.
 *
 * Difficulty levels:
 *   - 16 bits (~65K attempts) ≈ 50-200ms on modern browser
 *   - 18 bits (~262K attempts) ≈ 200-800ms
 *   - 20 bits (~1M attempts) ≈ 500ms-2s
 *   - 22 bits (~4M attempts) ≈ 2-8s (use for high-risk IPs)
 */

import { createHmac, randomBytes } from 'crypto';
import { redis } from './redis';

const POW_SECRET = process.env.POW_SECRET || process.env.SESSION_SECRET || 'pow-default-secret';
const POW_TTL_SECONDS = 300; // Challenge expires in 5 minutes
const DEFAULT_DIFFICULTY = 18;

export interface PowChallenge {
  challenge: string;
  difficulty: number;
  expiresAt: number;
}

/**
 * Generate a new PoW challenge.
 * The challenge includes a timestamp and is signed with HMAC to prevent forgery.
 */
export function generateChallenge(difficulty?: number): PowChallenge {
  const diff = difficulty ?? parseInt(process.env.POW_DIFFICULTY || String(DEFAULT_DIFFICULTY), 10);
  const nonce = randomBytes(16).toString('hex');
  const timestamp = Date.now();
  const payload = `${nonce}:${timestamp}`;
  const signature = createHmac('sha256', POW_SECRET).update(payload).digest('hex').slice(0, 16);
  const challenge = `${payload}:${signature}`;

  return {
    challenge,
    difficulty: diff,
    expiresAt: timestamp + POW_TTL_SECONDS * 1000,
  };
}

/**
 * Verify a PoW solution server-side.
 * 1. Validate challenge signature (not forged)
 * 2. Check challenge hasn't expired
 * 3. Check challenge hasn't been used (replay protection)
 * 4. Verify the hash meets the difficulty requirement
 */
export async function verifySolution(
  challenge: string,
  nonce: string,
  difficulty: number,
): Promise<{ valid: boolean; reason?: string }> {
  // 1. Validate challenge format and signature
  const parts = challenge.split(':');
  if (parts.length !== 3) {
    return { valid: false, reason: 'invalid_challenge_format' };
  }

  const [challengeNonce, timestampStr, signature] = parts;
  const payload = `${challengeNonce}:${timestampStr}`;
  const expectedSig = createHmac('sha256', POW_SECRET).update(payload).digest('hex').slice(0, 16);

  if (signature !== expectedSig) {
    return { valid: false, reason: 'invalid_signature' };
  }

  // 2. Check expiry
  const timestamp = parseInt(timestampStr, 10);
  if (Date.now() - timestamp > POW_TTL_SECONDS * 1000) {
    return { valid: false, reason: 'challenge_expired' };
  }

  // 3. Replay protection — each challenge can only be solved once
  const replayKey = `pow:used:${challenge}`;
  const alreadyUsed = await redis.set(replayKey, '1', 'EX', POW_TTL_SECONDS, 'NX');
  if (!alreadyUsed) {
    return { valid: false, reason: 'challenge_already_used' };
  }

  // 4. Verify hash meets difficulty
  const hashInput = challenge + nonce;
  const hash = await sha256Hex(hashInput);
  const leadingZeroBits = countLeadingZeroBits(hash);

  if (leadingZeroBits < difficulty) {
    return { valid: false, reason: 'insufficient_difficulty' };
  }

  return { valid: true };
}

/**
 * SHA-256 hash (Node.js crypto).
 */
async function sha256Hex(input: string): Promise<string> {
  const { createHash } = await import('crypto');
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Count leading zero bits in a hex string.
 * Each hex char = 4 bits. '0' = 4 zeros, '1' = 3, '2'-'3' = 2, '4'-'7' = 1, '8'-'f' = 0.
 */
function countLeadingZeroBits(hex: string): number {
  let bits = 0;
  for (const char of hex) {
    const nibble = parseInt(char, 16);
    if (nibble === 0) {
      bits += 4;
    } else {
      // Count leading zeros in this nibble
      if (nibble < 2) bits += 3;
      else if (nibble < 4) bits += 2;
      else if (nibble < 8) bits += 1;
      break;
    }
  }
  return bits;
}
