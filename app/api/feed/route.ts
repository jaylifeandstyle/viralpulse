// GET /api/feed
//
// The "For You" feed: posts from every featured account, merged and sorted
// newest-first, each enriched with its author's display name + avatar so a
// mixed-author feed renders correctly. Also returns the featured profiles
// for the Suggested Profiles card.

import { NextResponse } from 'next/server';
import { readPosts } from '@/store/post-store';
import { getProfile } from '@/lib/x-profile';
import { featuredHandles } from '@/lib/featured';
import type { FeedItem, SuggestedProfile } from '@/lib/feed-types';

export async function GET() {
  try {
    const handles = featuredHandles();

    const profiles: SuggestedProfile[] = await Promise.all(
      handles.map(async (h) => {
        const p = await getProfile(h);
        return {
          handle: h,
          displayName: p?.displayName ?? h,
          avatarUrl: p?.avatarUrl,
        };
      }),
    );
    const byHandle = new Map(profiles.map((p) => [p.handle, p]));

    const grouped = await Promise.all(handles.map((h) => readPosts(h)));
    const posts: FeedItem[] = grouped
      .flat()
      .sort((a, b) => (a.postedAt < b.postedAt ? 1 : -1))
      .map((post) => {
        const prof = byHandle.get(post.handle);
        return {
          ...post,
          authorName: prof?.displayName ?? post.handle,
          authorAvatarUrl: prof?.avatarUrl,
        };
      });

    return NextResponse.json({ success: true, posts, profiles });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
