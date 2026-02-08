import { prisma } from '@/lib/db';
import { Shield, Ticket, Clock, Users } from 'lucide-react';
import { JoinQueueButton } from '@/components/JoinQueueButton';

export const dynamic = 'force-dynamic';

async function getEvent() {
  let event = await prisma.eventConfig.findFirst({ where: { isActive: true } });
  if (!event) {
    event = await prisma.eventConfig.create({
      data: {
        name: 'QueueShield Security Challenge 2026',
        description: 'The ultimate bot detection stress test. Can your automation survive our multi-layered defense system?',
        venue: 'Digital Arena — Cyberspace',
        eventDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        totalTickets: 100,
        soldTickets: 0,
        isActive: true,
      },
    });
  }
  return event;
}

export default async function EventPage() {
  const event = await getEvent();
  const remaining = event.totalTickets - event.soldTickets;

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-2xl animate-fade-in">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-brand-100 text-brand-700 text-sm font-medium mb-4">
            <Shield className="w-4 h-4" />
            QueueShield Testbed
          </div>
          <h1 className="text-4xl font-bold text-slate-900 mb-2 tracking-tight">
            {event.name}
          </h1>
          <p className="text-slate-500 text-lg max-w-lg mx-auto">
            {event.description}
          </p>
        </div>

        {/* Event Card */}
        <div className="glass rounded-2xl p-8 mb-6">
          <div className="grid grid-cols-3 gap-6 mb-8">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-brand-50 text-brand-600 mb-3">
                <Clock className="w-6 h-6" />
              </div>
              <div className="text-sm text-slate-500">Event Date</div>
              <div className="font-semibold text-slate-900">
                {event.eventDate.toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </div>
            </div>
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-brand-50 text-brand-600 mb-3">
                <Ticket className="w-6 h-6" />
              </div>
              <div className="text-sm text-slate-500">Tickets Left</div>
              <div className="font-semibold text-slate-900">
                {remaining} / {event.totalTickets}
              </div>
            </div>
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-brand-50 text-brand-600 mb-3">
                <Users className="w-6 h-6" />
              </div>
              <div className="text-sm text-slate-500">Venue</div>
              <div className="font-semibold text-slate-900 text-xs">
                {event.venue}
              </div>
            </div>
          </div>

          {remaining > 0 ? (
            <JoinQueueButton eventId={event.id} />
          ) : (
            <div className="text-center py-4">
              <p className="text-danger-600 font-semibold text-lg">Sold Out</p>
              <p className="text-slate-500 text-sm mt-1">All tickets have been claimed.</p>
            </div>
          )}
        </div>

        {/* Security Notice */}
        <div className="glass rounded-xl p-4 text-center">
          <p className="text-xs text-slate-400">
            This platform implements multi-layered bot detection including TLS fingerprinting,
            behavioral analysis, Canvas/WebGL fingerprinting, and CAPTCHA challenges.
            All sessions are monitored and scored in real time.
          </p>
        </div>
      </div>
    </main>
  );
}
