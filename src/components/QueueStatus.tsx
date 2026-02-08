'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, Users, Loader2, CheckCircle, XCircle } from 'lucide-react';

interface Props {
  sessionId: string;
}

interface QueueData {
  position: number;
  totalInQueue: number;
  estimatedWaitSeconds: number;
}

export function QueueStatus({ sessionId }: Props) {
  const [data, setData] = useState<QueueData | null>(null);
  const [status, setStatus] = useState<'connecting' | 'waiting' | 'admitted' | 'removed' | 'error'>('connecting');
  const [accessUrl, setAccessUrl] = useState<string | null>(null);
  const router = useRouter();
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource(`/api/queue/sse?sessionId=${sessionId}`);
    eventSourceRef.current = es;

    es.addEventListener('position', (event) => {
      const parsed = JSON.parse(event.data);
      setData(parsed);
      setStatus('waiting');
    });

    es.addEventListener('admitted', (event) => {
      const parsed = JSON.parse(event.data);
      setStatus('admitted');
      setAccessUrl(parsed.accessUrl);
      // Auto-redirect after 2s
      setTimeout(() => {
        router.push(parsed.accessUrl);
      }, 2000);
    });

    es.addEventListener('removed', () => {
      setStatus('removed');
    });

    es.addEventListener('challenge', (event) => {
      const parsed = JSON.parse(event.data);
      es.close();
      router.push(parsed.challengeUrl);
    });

    es.onerror = () => {
      if (status !== 'admitted') {
        setStatus('error');
        // Auto-reconnect after 5s
        setTimeout(() => {
          setStatus('connecting');
        }, 5000);
      }
    };

    return () => {
      es.close();
    };
  }, [sessionId, router, status]);

  if (status === 'connecting') {
    return (
      <div className="text-center py-12 animate-fade-in">
        <Loader2 className="w-10 h-10 text-brand-500 animate-spin mx-auto mb-4" />
        <p className="text-slate-600 font-medium">Connecting to queue...</p>
      </div>
    );
  }

  if (status === 'admitted') {
    return (
      <div className="text-center py-12 animate-fade-in">
        <CheckCircle className="w-16 h-16 text-success-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-slate-900 mb-2">You&apos;re In!</h2>
        <p className="text-slate-600 mb-4">Redirecting to purchase page...</p>
        {accessUrl && (
          <a
            href={accessUrl}
            className="inline-block px-6 py-3 bg-success-600 text-white rounded-xl font-semibold hover:bg-success-700 transition-colors"
          >
            Go to Purchase Page
          </a>
        )}
      </div>
    );
  }

  if (status === 'removed') {
    return (
      <div className="text-center py-12 animate-fade-in">
        <XCircle className="w-16 h-16 text-danger-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Session Ended</h2>
        <p className="text-slate-600 mb-4">Your session was removed from the queue.</p>
        <a
          href="/"
          className="inline-block px-6 py-3 bg-brand-600 text-white rounded-xl font-semibold hover:bg-brand-700 transition-colors"
        >
          Try Again
        </a>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="text-center py-12 animate-fade-in">
        <XCircle className="w-12 h-12 text-warning-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-slate-900 mb-2">Connection Lost</h2>
        <p className="text-slate-600 mb-4">Attempting to reconnect...</p>
      </div>
    );
  }

  // Waiting state
  const progress = data ? Math.max(5, Math.min(95, 100 - (data.position / Math.max(data.totalInQueue, 1)) * 100)) : 5;

  return (
    <div className="animate-fade-in">
      <div className="text-center mb-8">
        <div className="relative inline-flex items-center justify-center w-32 h-32 mb-4">
          <svg className="w-32 h-32 -rotate-90" viewBox="0 0 128 128">
            <circle cx="64" cy="64" r="56" fill="none" stroke="#e2e8f0" strokeWidth="8" />
            <circle
              cx="64" cy="64" r="56" fill="none" stroke="#4c6ef5" strokeWidth="8"
              strokeDasharray={`${progress * 3.52} 352`}
              strokeLinecap="round"
              className="transition-all duration-1000 ease-out"
            />
          </svg>
          <span className="absolute text-3xl font-bold text-brand-700">
            #{data?.position || '?'}
          </span>
        </div>
        <p className="text-slate-500 text-sm">Your position in the queue</p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="glass rounded-xl p-4 text-center">
          <Users className="w-5 h-5 text-brand-500 mx-auto mb-2" />
          <div className="text-2xl font-bold text-slate-900">{data?.totalInQueue || 0}</div>
          <div className="text-xs text-slate-500">In Queue</div>
        </div>
        <div className="glass rounded-xl p-4 text-center">
          <Clock className="w-5 h-5 text-brand-500 mx-auto mb-2" />
          <div className="text-2xl font-bold text-slate-900">
            {data ? formatTime(data.estimatedWaitSeconds) : '--'}
          </div>
          <div className="text-xs text-slate-500">Est. Wait</div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-slate-200 rounded-full h-2 mb-4">
        <div
          className="bg-gradient-to-r from-brand-500 to-brand-600 h-2 rounded-full transition-all duration-1000 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      <p className="text-center text-xs text-slate-400">
        Do not close this tab. Your position will be lost.
      </p>
    </div>
  );
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}
