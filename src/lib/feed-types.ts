// Shared types for the "For You" feed, imported by both the API route
// (app/api/feed) and the client component (src/components/ForYouFeed).
// Lives under src/ so the @/ alias resolves from both.

import type { StoredPost } from '@/store/store-shared';

export type FeedItem = StoredPost & {
  authorName: string;
  authorAvatarUrl?: string;
};

export type SuggestedProfile = {
  handle: string;
  displayName: string;
  avatarUrl?: string;
};
