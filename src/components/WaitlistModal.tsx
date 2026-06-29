'use client';

import { useEffect, useState } from 'react';

type Props = {
  open: boolean;
  // What the user was trying to do, for the modal copy.
  // 'like' | 'comment' | 'reshare' | 'generic'
  intent?: 'like' | 'comment' | 'reshare' | 'generic';
  onClose: () => void;
};

const INTENT_COPY: Record<NonNullable<Props['intent']>, string> = {
  like: 'Join the waitlist to like posts on ViralPulse X.',
  comment: 'Join the waitlist to comment on posts.',
  reshare: 'Join the waitlist to reshare posts to your feed.',
  generic: 'Join the waitlist for early access.',
};

export function WaitlistModal({ open, intent = 'generic', onClose }: Props) {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setEmail('');
      setDone(false);
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Please enter a valid email.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed, source: intent }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? 'Signup failed');
      setDone(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-gray-900 border border-sky-500/40 rounded-2xl w-full max-w-md shadow-2xl p-7">
        <div className="flex justify-between items-start gap-4 mb-4">
          <h2 className="text-xl font-bold text-white leading-tight">
            {done ? 'You’re on the list' : 'ViralPulse X is in early access'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-white text-xl transition shrink-0 mt-0.5"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {done ? (
          <p className="text-sm text-gray-400 leading-relaxed">
            Thanks — we will email you the moment ViralPulse X opens to new accounts.
          </p>
        ) : (
          <>
            <p className="text-sm text-gray-400 leading-relaxed mb-5">
              {INTENT_COPY[intent]}
            </p>
            <form onSubmit={submit} className="space-y-3">
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                placeholder="you@example.com"
                className="w-full bg-gray-800 rounded-xl px-4 py-3 text-white text-sm border border-gray-700 focus:border-sky-500 outline-none transition-colors disabled:opacity-60"
              />
              {error && (
                <p className="text-xs text-red-400">{error}</p>
              )}
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-sky-500 hover:bg-sky-400 disabled:bg-sky-900 disabled:opacity-50 disabled:cursor-not-allowed text-white py-3 rounded-xl font-semibold transition text-sm"
              >
                {submitting ? 'Joining…' : 'Join the waitlist'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
