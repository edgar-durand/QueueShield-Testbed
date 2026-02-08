'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, CreditCard } from 'lucide-react';

interface Props {
  token: string;
  sessionId: string;
}

export function PurchaseForm({ token, sessionId }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handlePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, sessionId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Purchase failed');
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handlePurchase} className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Full Name
        </label>
        <input
          type="text"
          required
          placeholder="John Doe"
          className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-all"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Email Address
        </label>
        <input
          type="email"
          required
          placeholder="john@example.com"
          className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-all"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Card Number (Test)
        </label>
        <div className="relative">
          <input
            type="text"
            required
            placeholder="4242 4242 4242 4242"
            maxLength={19}
            className="w-full px-4 py-3 pl-12 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-all"
          />
          <CreditCard className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Expiry
          </label>
          <input
            type="text"
            required
            placeholder="12/25"
            maxLength={5}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-all"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            CVC
          </label>
          <input
            type="text"
            required
            placeholder="123"
            maxLength={3}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-all"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full py-4 px-8 bg-gradient-to-r from-success-600 to-success-700 text-white font-semibold text-lg rounded-xl shadow-lg hover:shadow-xl hover:from-success-700 hover:to-green-800 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
      >
        {loading ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            Processing...
          </span>
        ) : (
          'Complete Purchase'
        )}
      </button>

      {error && (
        <p className="text-danger-600 text-sm text-center animate-fade-in">{error}</p>
      )}
    </form>
  );
}
