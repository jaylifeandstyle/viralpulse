'use client';

import type { StoredPost } from '@/store/store-shared';

type Props = {
  post: StoredPost;
  authorName: string;
  authorAvatarUrl?: string;
  onEngagement: (intent: 'like' | 'comment' | 'reshare') => void;
};

function formatRelative(iso: string): string {
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86_400) return `${Math.floor(sec / 3600)}h`;
  if (sec < 2_592_000) return `${Math.floor(sec / 86_400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function compactNumber(n: number | undefined): string {
  if (!n || n < 1000) return String(n ?? 0);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace('.0', '')}k`;
  return `${(n / 1_000_000).toFixed(1).replace('.0', '')}M`;
}

export function Post({ post, authorName, authorAvatarUrl, onEngagement }: Props) {
  const xStats = post.xStats;

  return (
    <article className="border-b border-gray-800 px-5 py-4 hover:bg-gray-900/30 transition-colors">
      <div className="flex gap-3">
        {/* Avatar */}
        <div className="shrink-0">
          {authorAvatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={authorAvatarUrl}
              alt={authorName}
              className="w-11 h-11 rounded-full object-cover"
            />
          ) : (
            <div className="w-11 h-11 rounded-full bg-gray-700" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          {/* Author + timestamp */}
          <div className="flex items-center gap-1.5 text-sm">
            <span className="font-bold text-white">{authorName}</span>
            <a
              href={`https://x.com/${post.handle}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-500 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              @{post.handle}
            </a>
            <span className="text-gray-600">·</span>
            <span className="text-gray-500">{formatRelative(post.postedAt)}</span>
          </div>

          {/* Source opportunity badge */}
          {post.opportunityTopic && (
            <div className="text-xs text-blue-400/80 mt-0.5">
              via ViralPulse X · {post.opportunityTopic}
            </div>
          )}

          {/* Text */}
          <p className="text-[15px] text-gray-100 leading-relaxed whitespace-pre-wrap mt-2">
            {post.text}
          </p>

          {/* Image */}
          {post.imageUrl && (
            <div className="mt-3 rounded-2xl overflow-hidden border border-gray-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={post.imageUrl} alt="" className="w-full h-auto" />
            </div>
          )}

          {/* X stats (small, factual) */}
          {xStats && (xStats.favoriteCount > 0 || xStats.replyCount > 0 || xStats.retweetCount > 0) && (
            <p className="text-xs text-gray-500 mt-3">
              On X: {compactNumber(xStats.favoriteCount)} likes · {compactNumber(xStats.replyCount)} replies
              {xStats.retweetCount > 0 && ` · ${compactNumber(xStats.retweetCount)} reposts`}
            </p>
          )}

          {/* Native engagement (placeholders → waitlist) */}
          <div className="flex items-center gap-8 mt-3 text-gray-500">
            <button
              type="button"
              onClick={() => onEngagement('comment')}
              className="flex items-center gap-1.5 text-sm hover:text-sky-400 transition-colors group"
            >
              <span className="w-8 h-8 -m-1.5 rounded-full flex items-center justify-center group-hover:bg-sky-500/10">💬</span>
              <span>0</span>
            </button>
            <button
              type="button"
              onClick={() => onEngagement('reshare')}
              className="flex items-center gap-1.5 text-sm hover:text-green-400 transition-colors group"
            >
              <span className="w-8 h-8 -m-1.5 rounded-full flex items-center justify-center group-hover:bg-green-500/10">🔁</span>
              <span>0</span>
            </button>
            <button
              type="button"
              onClick={() => onEngagement('like')}
              className="flex items-center gap-1.5 text-sm hover:text-pink-400 transition-colors group"
            >
              <span className="w-8 h-8 -m-1.5 rounded-full flex items-center justify-center group-hover:bg-pink-500/10">💜</span>
              <span>0</span>
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
