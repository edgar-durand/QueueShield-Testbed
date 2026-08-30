import { NextRequest, NextResponse } from 'next/server';
import { createAdminToken, validateBasicAuth } from '@/lib/auth';
import { RateLimiter } from '@/lib/rate-limiter';
import { getClientIp } from '@/lib/client-ip';

export async function POST(req: NextRequest) {
  try {
    // Throttle credential attempts to slow brute-force.
    const ip = getClientIp(req.headers, req.ip);
    const rl = await RateLimiter.check(`admin-login:${ip}`, 5, 60);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please wait before retrying.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
      );
    }

    const { username, password } = await req.json();

    const encoded = Buffer.from(`${username}:${password}`).toString('base64');
    const valid = validateBasicAuth(`Basic ${encoded}`);

    if (!valid) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const token = await createAdminToken();

    return NextResponse.json({ token });
  } catch (err) {
    console.error('Admin login error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
