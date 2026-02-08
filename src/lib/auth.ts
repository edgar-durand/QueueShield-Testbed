import { SignJWT, jwtVerify } from 'jose';

const SECRET = new TextEncoder().encode(process.env.SESSION_SECRET || 'change-me-in-production');

export async function createAdminToken(): Promise<string> {
  return new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(SECRET);
}

export async function verifyAdminToken(token: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
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
    const [username, password] = decoded.split(':');
    return (
      username === (process.env.ADMIN_USERNAME || 'admin') &&
      password === (process.env.ADMIN_PASSWORD || 'admin123')
    );
  } catch {
    return false;
  }
}
