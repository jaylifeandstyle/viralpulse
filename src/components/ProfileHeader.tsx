import type { StoredProfile } from '@/store/store-shared';

type Props = {
  profile: StoredProfile | null;
  handle: string;
};

function compactNumber(n: number | undefined): string {
  if (!n) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace('.0', '')}K`;
  return `${(n / 1_000_000).toFixed(1).replace('.0', '')}M`;
}

export function ProfileHeader({ profile, handle }: Props) {
  const displayName = profile?.displayName ?? handle;
  const bio = profile?.bio;
  const avatarUrl = profile?.avatarUrl;
  const bannerUrl = profile?.bannerUrl;

  return (
    <div>
      {/* Banner */}
      <div className="relative h-44 sm:h-52 bg-gradient-to-br from-sky-700 via-indigo-700 to-fuchsia-700 overflow-hidden">
        {bannerUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={bannerUrl} alt="" className="w-full h-full object-cover" />
        )}
      </div>

      {/* Avatar — center-overlapping (vs. X's bottom-left) */}
      <div className="relative flex justify-center -mt-14 sm:-mt-16">
        <div className="rounded-full ring-4 ring-gray-950 bg-gray-800 w-28 h-28 sm:w-32 sm:h-32 overflow-hidden">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-3xl text-gray-500 font-bold">
              {displayName.slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>
      </div>

      {/* Identity block */}
      <div className="text-center px-6 mt-3">
        <h1 className="text-2xl font-bold text-white tracking-tight">{displayName}</h1>
        <a
          href={`https://x.com/${handle}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-gray-500 hover:underline"
        >
          @{handle}
        </a>
        {bio && (
          <p className="text-sm text-gray-300 mt-3 max-w-md mx-auto leading-relaxed whitespace-pre-wrap">
            {bio}
          </p>
        )}
        <div className="flex justify-center gap-6 mt-4 text-sm">
          <span>
            <strong className="text-white">{compactNumber(profile?.followingCount)}</strong>{' '}
            <span className="text-gray-500">following</span>
          </span>
          <span>
            <strong className="text-white">{compactNumber(profile?.followersCount)}</strong>{' '}
            <span className="text-gray-500">followers</span>
          </span>
        </div>
      </div>
    </div>
  );
}
