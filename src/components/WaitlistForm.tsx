'use client';

import { useState } from 'react';

type Props = {
  /** Telemetry label so we can see which form converted (hero / bottom / …). */
  source: string;
};

export function WaitlistForm({ source }: Props) {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        body: JSON.stringify({ email: trimmed, source }),
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

  if (done) {
    return (
      <div className="text-sky-400 text-sm font-medium">
        ✓ You’re on the list. We’ll be in touch.
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col sm:flex-row gap-2 max-w-md mx-auto"
    >
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={submitting}
        placeholder="you@example.com"
        className="flex-1 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 text-white text-sm focus:border-sky-500 outline-none transition-colors disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={submitting}
        className="bg-sky-500 hover:bg-sky-400 disabled:bg-sky-900 disabled:opacity-50 text-white px-5 py-3 rounded-xl font-semibold text-sm transition-colors"
      >
        {submitting ? 'Joining…' : 'Join waitlist'}
      </button>
      {error && (
        <p className="text-xs text-red-400 sm:absolute sm:translate-y-12">{error}</p>
      )}
    </form>
  );
}
