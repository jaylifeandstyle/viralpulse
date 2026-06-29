import Link from 'next/link';
import { WaitlistForm } from '@/components/WaitlistForm';

const FEATURES = [
  {
    title: 'Real-time story detection',
    body: 'We watch breaking news and what’s rising on X around the clock, then surface only the stories most likely to land with your audience.',
  },
  {
    title: 'Sharp drafts in your voice',
    body: 'Each story becomes a journalist-grade tweet with angle, hook, and hashtags — ready to post in one tap.',
  },
  {
    title: 'Engagement that stays on-platform',
    body: 'Likes, comments, and reshares live on ViralPulse — your audience grows here, not somewhere else.',
  },
];

export default function HomePage() {
  const ownerHandle = (process.env.VP_OWNER_HANDLE ?? 'jlces').toLowerCase();

  return (
    <div className="bg-gray-950 text-white">
      {/* Hero */}
      <section className="px-5 pt-20 pb-24 text-center max-w-3xl mx-auto">
        <p className="text-xs uppercase tracking-widest text-sky-400 font-semibold mb-4">
          Early access
        </p>
        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-tight">
          Grow your X audience
          <br />
          while you sleep.
        </h1>
        <p className="text-lg text-gray-400 mt-6 leading-relaxed max-w-xl mx-auto">
          ViralPulse spots tomorrow’s stories today, drafts your post in your voice, and gives your work a home that isn’t someone else’s timeline.
        </p>
        <div className="mt-10">
          <WaitlistForm source="hero" />
        </div>
        <p className="text-xs text-gray-600 mt-4">
          Built for journalists, creators, and anyone who lives on the news cycle.
        </p>
      </section>

      {/* Value props */}
      <section className="bg-gray-900/40 border-y border-gray-800 py-20 px-5">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="bg-gray-900 border border-gray-800 rounded-2xl p-6"
            >
              <h3 className="font-bold text-white text-lg">{f.title}</h3>
              <p className="text-sm text-gray-400 mt-3 leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Live demo CTA */}
      <section className="px-5 py-20 text-center max-w-2xl mx-auto">
        <h2 className="text-3xl font-bold tracking-tight">See it in action</h2>
        <p className="text-gray-400 mt-3">
          Watch how ViralPulse is being used today on a live profile.
        </p>
        <Link
          href={`/@${ownerHandle}`}
          className="inline-block mt-6 bg-white text-black px-6 py-3 rounded-xl font-semibold text-sm hover:bg-gray-100 transition-colors"
        >
          View live profile →
        </Link>
      </section>

      {/* Bottom waitlist */}
      <section className="border-t border-gray-800 py-20 px-5 text-center">
        <h2 className="text-2xl font-bold tracking-tight">
          Get in on the next wave.
        </h2>
        <p className="text-gray-400 mt-2 text-sm">
          We’ll email you the moment ViralPulse opens to new accounts.
        </p>
        <div className="mt-6 max-w-md mx-auto">
          <WaitlistForm source="bottom" />
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-800 py-8 px-5 text-center text-xs text-gray-600">
        © {new Date().getFullYear()} ViralPulse
      </footer>
    </div>
  );
}
