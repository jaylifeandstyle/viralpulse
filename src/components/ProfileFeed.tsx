'use client';

import { useState } from 'react';
import type { StoredPost } from '@/store/store-shared';
import { Post } from './Post';
import { WaitlistModal } from './WaitlistModal';

type Props = {
  posts: StoredPost[];
  authorName: string;
  authorAvatarUrl?: string;
};

type Intent = 'like' | 'comment' | 'reshare' | 'generic';

export function ProfileFeed({ posts, authorName, authorAvatarUrl }: Props) {
  const [modalIntent, setModalIntent] = useState<Intent | null>(null);

  if (posts.length === 0) {
    return (
      <div className="text-center py-20 text-gray-500 border-b border-gray-800">
        <p className="text-base">No posts yet.</p>
        <p className="text-sm text-gray-600 mt-1">
          First stories shipping soon — check back.
        </p>
      </div>
    );
  }

  return (
    <>
      <div>
        {posts.map((p) => (
          <Post
            key={p.tweetId}
            post={p}
            authorName={authorName}
            authorAvatarUrl={authorAvatarUrl}
            onEngagement={(intent) => setModalIntent(intent)}
          />
        ))}
      </div>
      <WaitlistModal
        open={modalIntent !== null}
        intent={modalIntent ?? undefined}
        onClose={() => setModalIntent(null)}
      />
    </>
  );
}
