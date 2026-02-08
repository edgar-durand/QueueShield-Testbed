import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateBasicAuth, verifyAdminToken } from '@/lib/auth';

async function authenticate(req: NextRequest): Promise<boolean> {
  const auth = req.headers.get('authorization');
  if (!auth) return false;
  if (auth.startsWith('Bearer ')) return verifyAdminToken(auth.slice(7));
  if (auth.startsWith('Basic ')) return validateBasicAuth(auth);
  return false;
}

export async function GET(req: NextRequest) {
  if (!(await authenticate(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const event = await prisma.eventConfig.findFirst({ where: { isActive: true } });
  if (!event) {
    return NextResponse.json({ error: 'No active event' }, { status: 404 });
  }

  return NextResponse.json({ event });
}

export async function PATCH(req: NextRequest) {
  if (!(await authenticate(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { totalTickets, soldTickets, name, isActive } = body;

    const event = await prisma.eventConfig.findFirst({ where: { isActive: true } });
    if (!event) {
      return NextResponse.json({ error: 'No active event' }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    if (totalTickets !== undefined) data.totalTickets = Math.max(0, parseInt(totalTickets, 10));
    if (soldTickets !== undefined) data.soldTickets = Math.max(0, parseInt(soldTickets, 10));
    if (name !== undefined) data.name = String(name);
    if (isActive !== undefined) data.isActive = Boolean(isActive);

    const updated = await prisma.eventConfig.update({
      where: { id: event.id },
      data,
    });

    return NextResponse.json({ event: updated });
  } catch (err) {
    console.error('Event update error:', err);
    return NextResponse.json({ error: 'Failed to update event' }, { status: 500 });
  }
}
