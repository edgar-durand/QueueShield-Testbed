import { NextRequest, NextResponse } from 'next/server';
import { createAdminToken, validateBasicAuth } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
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
