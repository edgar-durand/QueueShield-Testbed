'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Shield, Cpu, Lock } from 'lucide-react';

declare global {
  interface Window {
    grecaptcha?: {
      ready: (cb: () => void) => void;
      execute: (siteKey: string, opts: { action: string }) => Promise<string>;
    };
  }
}

type JoinPhase = 'idle' | 'js_challenge' | 'pow' | 'recaptcha' | 'joining' | 'done';

export function JoinQueueButton({ eventId }: { eventId: string }) {
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<JoinPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [powProgress, setPowProgress] = useState(0);
  const router = useRouter();

  // Step 1: JS challenge — proves browser can execute JavaScript
  const solveJsChallenge = useCallback(async (): Promise<{ seed: string; answer: string }> => {
    setPhase('js_challenge');
    // Compute SHA-256 in browser using SubtleCrypto
    const seed = Array.from(crypto.getRandomValues(new Uint8Array(8)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    const encoder = new TextEncoder();
    const data = encoder.encode(seed + 'queueshield');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const answer = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
    return { seed, answer };
  }, []);

  // Step 2: Proof of Work — browser must find nonce with leading zeros
  const solvePoW = useCallback(async (): Promise<{
    challenge: string;
    nonce: string;
    difficulty: number;
  }> => {
    setPhase('pow');
    setPowProgress(0);

    // Get challenge from server
    const challengeRes = await fetch('/api/pow');
    if (!challengeRes.ok) throw new Error('Failed to get PoW challenge');
    const { challenge, difficulty } = await challengeRes.json();

    // Solve in worker-like loop (yields to UI every batch)
    const BATCH_SIZE = 5000;
    let nonce = 0;
    const encoder = new TextEncoder();

    while (true) {
      for (let i = 0; i < BATCH_SIZE; i++) {
        const input = challenge + String(nonce);
        const data = encoder.encode(input);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = new Uint8Array(hashBuffer);

        // Check leading zero bits
        let zeroBits = 0;
        for (let j = 0; j < hashArray.length; j++) {
          const byte = hashArray[j];
          if (byte === 0) {
            zeroBits += 8;
          } else {
            let b = byte;
            while (b < 128 && zeroBits < difficulty) {
              zeroBits++;
              b <<= 1;
            }
            break;
          }
          if (zeroBits >= difficulty) break;
        }

        if (zeroBits >= difficulty) {
          setPowProgress(100);
          return { challenge, nonce: String(nonce), difficulty };
        }
        nonce++;
      }

      // Update progress estimate (difficulty 18 ≈ 262K attempts)
      const estimatedTotal = Math.pow(2, difficulty);
      setPowProgress(Math.min(95, Math.round((nonce / estimatedTotal) * 100)));

      // Yield to event loop for UI updates
      await new Promise(r => setTimeout(r, 0));
    }
  }, []);

  // Step 3: reCAPTCHA v3 token (invisible)
  const getRecaptchaToken = useCallback(async (): Promise<string | null> => {
    setPhase('recaptcha');
    const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
    if (!siteKey || !window.grecaptcha) return null;

    return new Promise<string>((resolve) => {
      window.grecaptcha!.ready(async () => {
        try {
          const token = await window.grecaptcha!.execute(siteKey, { action: 'join_queue' });
          resolve(token);
        } catch {
          resolve('');
        }
      });
    });
  }, []);

  const handleJoin = async () => {
    setLoading(true);
    setError(null);

    try {
      // Layer 1: JS challenge
      const jsChallenge = await solveJsChallenge();

      // Layer 2: Proof of Work
      const pow = await solvePoW();

      // Layer 3: reCAPTCHA v3
      const recaptchaToken = await getRecaptchaToken();

      // Submit everything to join the queue
      setPhase('joining');
      const res = await fetch('/api/queue/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          jsChallenge,
          pow,
          recaptchaToken,
        }),
      });

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const text = await res.text();
        console.error('Non-JSON response from /api/queue/join:', res.status, text.slice(0, 200));
        throw new Error(`Server error (${res.status}). Please try again.`);
      }

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to join queue');
      }

      const { sessionId, queueToken } = data;

      // Store session info in cookie for SSE auth
      document.cookie = `qs_session=${sessionId}; path=/; max-age=3600; samesite=strict`;
      document.cookie = `qs_token=${queueToken}; path=/; max-age=3600; samesite=strict`;

      setPhase('done');
      router.push(`/queue/${sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setPhase('idle');
      setLoading(false);
    }
  };

  const phaseLabel: Record<JoinPhase, string> = {
    idle: '',
    js_challenge: 'Verifying browser...',
    pow: `Solving challenge... ${powProgress}%`,
    recaptcha: 'Security check...',
    joining: 'Joining queue...',
    done: 'Redirecting...',
  };

  const PhaseIcon = phase === 'pow' ? Cpu : phase === 'recaptcha' ? Shield : Loader2;

  return (
    <div className="text-center">
      <button
        onClick={handleJoin}
        disabled={loading}
        className="relative w-full py-4 px-8 bg-gradient-to-r from-brand-600 to-brand-700 text-white font-semibold text-lg rounded-xl shadow-lg hover:shadow-xl hover:from-brand-700 hover:to-brand-800 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
      >
        {loading ? (
          <span className="inline-flex items-center gap-2">
            <PhaseIcon className={`w-5 h-5 ${phase === 'pow' ? 'animate-pulse' : 'animate-spin'}`} />
            {phaseLabel[phase] || 'Processing...'}
          </span>
        ) : (
          <span className="inline-flex items-center gap-2">
            <Lock className="w-5 h-5" />
            Join the Queue
          </span>
        )}
      </button>

      {/* PoW progress bar */}
      {phase === 'pow' && (
        <div className="mt-3 w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
          <div
            className="bg-brand-500 h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${powProgress}%` }}
          />
        </div>
      )}

      {error && (
        <p className="mt-3 text-danger-600 text-sm animate-fade-in">{error}</p>
      )}

      <p className="mt-2 text-xs text-slate-400">
        Protected by multi-layer bot detection
      </p>
    </div>
  );
}
