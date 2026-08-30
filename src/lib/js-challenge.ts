/**
 * Server-issued one-time seeds for the Level-0 JavaScript challenge.
 *
 * The browser proves JS execution by computing SHA-256(seed + "queueshield").
 * Binding the seed to a server-issued, single-use value (stored in Redis)
 * prevents a client from picking its own seed and pre-computing answers offline,
 * and forces a real round-trip per join attempt.
 */

import { randomBytes } from 'crypto';
import { redis } from './redis';

const SEED_TTL_SECONDS = 300; // 5 minutes
const SEED_KEY_PREFIX = 'js:seed:';

/** Issue a fresh single-use JS-challenge seed and persist it. */
export async function issueJsSeed(): Promise<string> {
  const seed = randomBytes(8).toString('hex');
  await redis.set(`${SEED_KEY_PREFIX}${seed}`, '1', 'EX', SEED_TTL_SECONDS);
  return seed;
}

/**
 * Atomically consume a seed. Returns true only if the seed was issued by us
 * and has not been used yet (replay protection).
 */
export async function consumeJsSeed(seed: string): Promise<boolean> {
  if (!seed || !/^[a-f0-9]{1,64}$/.test(seed)) return false;
  const removed = await redis.del(`${SEED_KEY_PREFIX}${seed}`);
  return removed === 1;
}
