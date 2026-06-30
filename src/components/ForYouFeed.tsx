'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Post } from './Post';
import { WaitlistModal } from './WaitlistModal';
import type { FeedItem, SuggestedProfile } from '@/lib/feed-types';

type Intent = 'like' | 'comment' | 'reshare' | 'generic';

export function ForYouFeed() {
  const [posts, setPosts] = useState<FeedItem[]>([]);
  const [profiles, setProfiles] = useState<SuggestedProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalIntent, setModalIntent] = useState<Intent | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/feed');
        const data = await res.json();
        if (cancelled || !data.success) return;
        setPosts(data.posts);
        setProfiles(data.profiles);
      } catch {
        // leave empty — render handles it
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <div className="flex gap-6">
        {/* Feed */}
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="text-center py-20 text-gray-600">Loading feed…</div>
          ) : posts.length === 0 ? (
            <div className="text-center py-20 text-gray-600 border border-dashed border-gray-800 rounded-2xl">
              <p className="text-lg">No posts yet.</p>
              <p className="text-sm mt-1">Posts shipped via ViralPulse X show up here.</p>
            </div>
          ) : (
            <div className="border border-gray-800 rounded-2xl overflow-hidden bg-gray-950">
              {posts.map((p) => (
                <Post
                  key={`${p.handle}-${p.tweetId}`}
                  post={p}
                  authorName={p.authorName}
                  authorAvatarUrl={p.authorAvatarUrl}
                  onEngagement={(intent) => setModalIntent(intent)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Suggested Profiles */}
        <aside className="w-64 shrink-0 hidden lg:block">
          <div className="bg-gray-900 rounded-2xl p-5 sticky top-20">
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">
              Suggested Profiles
            </h3>
            <div className="space-y-3">
              {profiles.map((prof) => (
                <Link
                  key={prof.handle}
                  href={`/@${prof.handle}`}
                  className="flex items-center gap-3 group"
                >
                  {prof.avatarUrl ? (
                    <Image
                      src={prof.avatarUrl}
                      alt={prof.displayName}
                      width={40}
                      height={40}
                      className="rounded-full object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center text-sm font-bold text-gray-400">
                      {prof.displayName.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate group-hover:underline">
                      {prof.displayName}
                    </p>
                    <p className="text-xs text-gray-500 truncate">@{prof.handle}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </aside>
      </div>

      <WaitlistModal
        open={modalIntent !== null}
        intent={modalIntent ?? undefined}
        onClose={() => setModalIntent(null)}
      />
    </>
  );
}
