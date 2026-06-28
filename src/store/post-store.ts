/**
 * src/store/post-store.ts
 *
 * Dispatcher for StoredPost. Mirrors opportunity-store.ts so both kinds of
 * records share the same file/KV detection — posts are persistent (no
 * dedupe, no age-out, never auto-deleted).
 */
import { StoredPost } from './store-shared';

export type { StoredPost } from './store-shared';

type PostBackend = {
  name: string;
  save: (post: StoredPost) => Promise<void>;
  read: (handle: string, limit?: number) => Promise<StoredPost[]>;
  remove: (handle: string, tweetId: string) => Promise<void>;
};

let _backend: PostBackend | null = null;

async function getBackend(): Promise<PostBackend> {
  if (_backend) return _backend;

  const override = process.env.VP_STORE_BACKEND?.toLowerCase();
  const kvConfigured = !!(
    (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ||
    (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
  );

  const useKv = override === 'kv' || (override !== 'file' && kvConfigured);

  if (useKv) {
    const m = await import('./store-kv');
    _backend = {
      name: 'kv',
      save: m.savePostKv,
      read: m.readPostsKv,
      remove: m.removePostKv,
    };
  } else {
    const m = await import('./store-file');
    _backend = {
      name: 'file',
      save: m.savePostFile,
      read: m.readPostsFile,
      remove: m.removePostFile,
    };
  }
  return _backend;
}

export async function savePost(post: StoredPost): Promise<void> {
  const b = await getBackend();
  await b.save(post);
}

export async function readPosts(handle: string, limit?: number): Promise<StoredPost[]> {
  const b = await getBackend();
  return b.read(handle, limit);
}

export async function removePost(handle: string, tweetId: string): Promise<void> {
  const b = await getBackend();
  await b.remove(handle, tweetId);
}
