import { prisma } from '@/lib/db';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { Shield } from 'lucide-react';
import { QueueStatus } from '@/components/QueueStatus';
import { FingerprintCollector } from '@/components/FingerprintCollector';
import { TelemetryCollector } from '@/components/TelemetryCollector';

export const dynamic = 'force-dynamic';

interface Props {
  params: { sessionId: string };
}

export default async function QueueWaitingRoom({ params }: Props) {
  // Session ownership validation: only the browser that joined can view
  const cookieStore = cookies();
  const ownerCookie = cookieStore.get('qs_session')?.value;

  if (!ownerCookie || ownerCookie !== params.sessionId) {
    redirect('/');
  }

  const session = await prisma.session.findUnique({
    where: { id: params.sessionId },
  });

  if (!session) {
    notFound();
  }

  if (session.isBanned) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="glass rounded-2xl p-8 max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-danger-50 flex items-center justify-center mx-auto mb-4">
            <Shield className="w-8 h-8 text-danger-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Access Denied</h1>
          <p className="text-slate-500">
            Your session has been flagged and removed from the queue.
          </p>
        </div>
      </main>
    );
  }

  if (session.status === 'ADMITTED' && session.accessToken) {
    redirect(`/purchase/${session.accessToken}`);
  }

  if (session.status === 'COMPLETED') {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="glass rounded-2xl p-8 max-w-md text-center">
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Purchase Complete</h1>
          <p className="text-slate-500">You have already completed your purchase.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-brand-100 text-brand-700 text-sm font-medium mb-4">
            <Shield className="w-4 h-4" />
            QueueShield Testbed
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Waiting Room</h1>
          <p className="text-slate-500 text-sm mt-1">
            Please wait while we process the queue
          </p>
        </div>

        {/* Queue Status Card */}
        <div className="glass rounded-2xl p-8">
          <QueueStatus sessionId={params.sessionId} />
        </div>

        {/* Session Info (SSR-rendered, visible in page source) */}
        <div className="mt-4 glass rounded-xl p-3">
          <p className="text-xs text-slate-400 text-center font-mono">
            Session: {params.sessionId.slice(0, 8)}...{params.sessionId.slice(-4)}
            {session.queueToken && (
              <> | Token: {session.queueToken.slice(0, 8)}...</>
            )}
          </p>
        </div>

        {/* Invisible security components */}
        <FingerprintCollector sessionId={params.sessionId} />
        <TelemetryCollector sessionId={params.sessionId} />
      </div>
    </main>
  );
}
