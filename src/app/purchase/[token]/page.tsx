import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';
import { Shield, CheckCircle, Ticket } from 'lucide-react';
import { PurchaseForm } from '@/components/PurchaseForm';

export const dynamic = 'force-dynamic';

interface Props {
  params: { token: string };
}

export default async function PurchasePage({ params }: Props) {
  const session = await prisma.session.findUnique({
    where: { accessToken: params.token },
  });

  if (!session) {
    notFound();
  }

  if (session.isBanned) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="glass rounded-2xl p-8 max-w-md text-center">
          <h1 className="text-2xl font-bold text-danger-600 mb-2">Access Denied</h1>
          <p className="text-slate-500">Your session has been terminated.</p>
        </div>
      </main>
    );
  }

  // Check token expiry
  if (session.accessTokenExpiresAt && session.accessTokenExpiresAt < new Date()) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="glass rounded-2xl p-8 max-w-md text-center">
          <h1 className="text-2xl font-bold text-warning-600 mb-2">Token Expired</h1>
          <p className="text-slate-500">Your access token has expired. Please rejoin the queue.</p>
          <a href="/" className="inline-block mt-4 px-6 py-3 bg-brand-600 text-white rounded-xl font-semibold hover:bg-brand-700 transition-colors">
            Back to Event
          </a>
        </div>
      </main>
    );
  }

  if (session.status === 'COMPLETED') {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="glass rounded-2xl p-8 max-w-md text-center animate-fade-in">
          <CheckCircle className="w-16 h-16 text-success-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Purchase Complete!</h1>
          <p className="text-slate-500 mb-4">Your test ticket has been secured.</p>
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
            <Ticket className="w-8 h-8 text-brand-500 mx-auto mb-2" />
            <p className="text-sm font-mono text-slate-600">
              Confirmation: {session.id.slice(0, 8).toUpperCase()}
            </p>
          </div>
        </div>
      </main>
    );
  }

  // Mark session as PURCHASING
  await prisma.session.update({
    where: { id: session.id },
    data: { status: 'PURCHASING' },
  });

  const event = await prisma.eventConfig.findFirst({ where: { isActive: true } });

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg animate-fade-in">
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-success-50 text-success-700 text-sm font-medium mb-4">
            <Shield className="w-4 h-4" />
            Access Granted
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Complete Your Purchase</h1>
          <p className="text-slate-500">
            {event?.name || 'QueueShield Security Challenge'}
          </p>
        </div>

        <div className="glass rounded-2xl p-8">
          <PurchaseForm token={params.token} sessionId={session.id} />
        </div>

        <div className="mt-4 text-center">
          <p className="text-xs text-slate-400">
            This is a test purchase. No real payment will be processed.
          </p>
        </div>
      </div>
    </main>
  );
}
