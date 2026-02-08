'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export function JoinQueueButton({ eventId }: { eventId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleJoin = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/queue/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to join queue');
      }

      const { sessionId, queueToken } = await res.json();

      // Store session info in cookie for SSE auth
      document.cookie = `qs_session=${sessionId}; path=/; max-age=3600; samesite=strict`;
      document.cookie = `qs_token=${queueToken}; path=/; max-age=3600; samesite=strict`;

      router.push(`/queue/${sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setLoading(false);
    }
  };

  return (
    <div className="text-center">
      <button
        onClick={handleJoin}
        disabled={loading}
        className="relative w-full py-4 px-8 bg-gradient-to-r from-brand-600 to-brand-700 text-white font-semibold text-lg rounded-xl shadow-lg hover:shadow-xl hover:from-brand-700 hover:to-brand-800 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
      >
        {loading ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            Joining Queue...
          </span>
        ) : (
          'Join the Queue'
        )}
      </button>
      {error && (
        <p className="mt-3 text-danger-600 text-sm animate-fade-in">{error}</p>
      )}
    </div>
  );
}
