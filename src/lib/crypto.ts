/**
 * Cryptographic utilities for token signing and device hashing.
 */

import { createHmac, createHash } from 'crypto';

const TOKEN_SECRET = process.env.SESSION_SECRET || 'change-me-in-production-please';

/**
 * Sign a queue token with HMAC-SHA256 to prevent forgery.
 */
export function signToken(token: string): string {
  return createHmac('sha256', TOKEN_SECRET).update(token).digest('hex').slice(0, 32);
}

/**
 * Verify a signed queue token.
 */
export function verifyTokenSignature(token: string, signature: string): boolean {
  const expected = signToken(token);
  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  let result = 0;
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Generate a device hash from fingerprint data.
 * Used for device deduplication — same device = same hash.
 */
export function generateDeviceHash(data: {
  canvasHash?: string;
  webglVendor?: string;
  webglRenderer?: string;
  screenResolution?: string;
  timezone?: string;
  languages?: string[];
  hardwareConcurrency?: number;
  colorDepth?: number;
}): string {
  const components = [
    data.canvasHash || '',
    data.webglVendor || '',
    data.webglRenderer || '',
    data.screenResolution || '',
    data.timezone || '',
    (data.languages || []).join(','),
    String(data.hardwareConcurrency || 0),
    String(data.colorDepth || 0),
  ];
  return createHash('sha256').update(components.join('|')).digest('hex');
}

/**
 * Generate a JS challenge token.
 * The browser must compute this to prove JS execution.
 */
export function generateJsChallenge(): { seed: string; expected: string } {
  const seed = createHash('sha256')
    .update(`${Date.now()}:${Math.random()}:${TOKEN_SECRET}`)
    .digest('hex')
    .slice(0, 16);

  // The expected answer: SHA-256(seed + "queueshield")
  const expected = createHash('sha256')
    .update(seed + 'queueshield')
    .digest('hex')
    .slice(0, 32);

  return { seed, expected };
}

/**
 * Verify a JS challenge response.
 */
export function verifyJsChallenge(seed: string, answer: string): boolean {
  const expected = createHash('sha256')
    .update(seed + 'queueshield')
    .digest('hex')
    .slice(0, 32);

  if (expected.length !== answer.length) return false;
  let result = 0;
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ answer.charCodeAt(i);
  }
  return result === 0;
}
