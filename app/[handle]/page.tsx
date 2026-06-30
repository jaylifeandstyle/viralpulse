import { notFound } from 'next/navigation';
import { readPosts } from '@/store/post-store';
import { getProfile } from '@/lib/x-profile';
import { featuredHandles } from '@/lib/featured';
import { ProfileHeader } from '@/components/ProfileHeader';
import { ProfileFeed } from '@/components/ProfileFeed';

type Params = Promise<{ handle: string }>;

// Only featured handles (owner + brand) render. Everything else 404s so the
// route doesn't act as a catch-all for typos and conflicting top-level paths.

function parseHandle(raw: string): string | null {
  // URL-decoded path segment. We accept both '@jay' (X-style) and 'jay'.
  const decoded = decodeURIComponent(raw);
  const stripped = decoded.startsWith('@') ? decoded.slice(1) : decoded;
  if (!/^[a-zA-Z0-9_]{1,15}$/.test(stripped)) return null;
  return stripped.toLowerCase();
}

export default async function ProfilePage({ params }: { params: Params }) {
  const { handle: raw } = await params;
  const handle = parseHandle(raw);
  if (!handle || !featuredHandles().includes(handle)) notFound();

  const [profile, posts] = await Promise.all([
    getProfile(handle),
    readPosts(handle),
  ]);

  return (
    <div className="bg-gray-950 text-white">
      <div className="max-w-2xl mx-auto border-x border-gray-800 min-h-[calc(100vh-3.5rem)]">
        <ProfileHeader profile={profile} handle={handle} />

        {/* Tabs */}
        <div className="border-b border-gray-800 mt-6 flex">
          <div className="flex-1 text-center py-4 border-b-2 border-sky-500 text-sm font-semibold text-white">
            Posts via ViralPulse X
          </div>
        </div>

        <ProfileFeed
          posts={posts}
          authorName={profile?.displayName ?? handle}
          authorAvatarUrl={profile?.avatarUrl}
        />
      </div>
    </div>
  );
}
