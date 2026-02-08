'use client';

import { Shield } from 'lucide-react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="glass rounded-2xl p-8 max-w-md text-center animate-fade-in">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-danger-50 mb-4">
          <Shield className="w-8 h-8 text-danger-500" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Something Went Wrong</h1>
        <p className="text-slate-500 mb-6 text-sm">
          {error.digest
            ? `Error reference: ${error.digest}`
            : 'An unexpected error occurred.'}
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-6 py-3 bg-brand-600 text-white rounded-xl font-semibold hover:bg-brand-700 transition-colors"
          >
            Try Again
          </button>
          <a
            href="/"
            className="px-6 py-3 bg-slate-100 text-slate-700 rounded-xl font-semibold hover:bg-slate-200 transition-colors"
          >
            Go Home
          </a>
        </div>
      </div>
    </main>
  );
}
