import { SignJWT, jwtVerify } from 'jose';
import { timingSafeEqual } from 'crypto';
import { getSessionSecret } from './env';

function secretKey(): Uint8Array {
  return new TextEncoder().encode(getSessionSecret());
}

/** Constant-time string comparison that tolerates differing lengths. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function createAdminToken(): Promise<string> {
  return new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(secretKey());
}

export async function verifyAdminToken(token: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return payload.role === 'admin';
  } catch {
    return false;
  }
}

export function validateBasicAuth(auth: string | null): boolean {
  if (!auth) return false;
  const [scheme, credentials] = auth.split(' ');
  if (scheme !== 'Basic' || !credentials) return false;
  try {
    const decoded = Buffer.from(credentials, 'base64').toString();
    const sep = decoded.indexOf(':');
    if (sep < 0) return false;
    const username = decoded.slice(0, sep);
    const password = decoded.slice(sep + 1);
    const userOk = safeEqual(username, process.env.ADMIN_USERNAME || 'admin');
    const passOk = safeEqual(password, process.env.ADMIN_PASSWORD || 'admin123');
    return userOk && passOk;
  } catch {
    return false;
  }
}
