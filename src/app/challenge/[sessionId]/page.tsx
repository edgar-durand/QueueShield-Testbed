import { prisma } from '@/lib/db';
import { notFound, redirect } from 'next/navigation';
import { Shield, AlertTriangle } from 'lucide-react';
import { CaptchaChallenge } from '@/components/CaptchaChallenge';

export const dynamic = 'force-dynamic';

interface Props {
  params: { sessionId: string };
}

export default async function ChallengePage({ params }: Props) {
  const session = await prisma.session.findUnique({
    where: { id: params.sessionId },
  });

  if (!session) notFound();

  if (session.isBanned) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="glass rounded-2xl p-8 max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-danger-50 flex items-center justify-center mx-auto mb-4">
            <Shield className="w-8 h-8 text-danger-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Access Denied</h1>
          <p className="text-slate-500">Your session has been terminated.</p>
        </div>
      </main>
    );
  }

  // If already passed challenge, redirect back to queue
  if (session.status === 'IN_QUEUE') {
    const lastAttempt = await prisma.captchaAttempt.findFirst({
      where: { sessionId: params.sessionId, passed: true },
      orderBy: { createdAt: 'desc' },
    });
    if (lastAttempt) {
      redirect(`/queue/${params.sessionId}`);
    }
  }

  // Mark as challenged
  if (session.status !== 'CHALLENGED') {
    await prisma.session.update({
      where: { id: params.sessionId },
      data: { status: 'CHALLENGED' },
    });
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md animate-fade-in">
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-warning-50 text-yellow-700 text-sm font-medium mb-4">
            <AlertTriangle className="w-4 h-4" />
            Security Challenge
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Verify You&apos;re Human</h1>
          <p className="text-slate-500 text-sm">
            Our system detected unusual activity. Please complete the challenge below to continue.
          </p>
        </div>

        <div className="glass rounded-2xl p-8">
          <CaptchaChallenge sessionId={params.sessionId} />
        </div>
      </div>
    </main>
  );
}
