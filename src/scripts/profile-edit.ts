/**
 * src/scripts/profile-edit.ts
 *
 * Updates the profile overrides for VP_OWNER_HANDLE. Any flag you pass
 * overwrites that field; unset fields fall through to the X-fetched data
 * at read time, so partial edits are fine.
 *
 * Usage:
 *   npm run profile:edit -- --bio "Building viralpulsex."
 *   npm run profile:edit -- --name "Jay" --banner-url https://…
 *   npm run profile:edit -- --clear bio        (remove a single override)
 *   npm run profile:edit -- --show             (print current overrides)
 */

import { readProfileOverrides, writeProfileOverrides } from '@/store/profile-store';
import { StoredProfileOverrides } from '@/store/store-shared';

type ParsedArgs = {
  name?: string;
  bio?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  clear?: ('name' | 'bio' | 'avatarUrl' | 'bannerUrl')[];
  show?: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = argv[i + 1];
    switch (flag) {
      case '--name':
        out.name = next; i++; break;
      case '--bio':
        out.bio = next; i++; break;
      case '--avatar-url':
        out.avatarUrl = next; i++; break;
      case '--banner-url':
        out.bannerUrl = next; i++; break;
      case '--clear': {
        const fieldMap: Record<string, NonNullable<ParsedArgs['clear']>[number]> = {
          name: 'name',
          bio: 'bio',
          'avatar-url': 'avatarUrl',
          'banner-url': 'bannerUrl',
        };
        const k = fieldMap[next];
        if (!k) throw new Error(`Unknown --clear field: ${next}`);
        out.clear = [...(out.clear ?? []), k];
        i++;
        break;
      }
      case '--show':
        out.show = true; break;
      default:
        throw new Error(`Unknown flag: ${flag}`);
    }
  }
  return out;
}

async function main() {
  const handle = (process.env.VP_OWNER_HANDLE ?? 'jay').toLowerCase();
  const args = parseArgs(process.argv.slice(2));

  const current = (await readProfileOverrides(handle)) ?? {
    handle,
    updatedAt: new Date().toISOString(),
  };

  if (args.show) {
    console.log(JSON.stringify(current, null, 2));
    return;
  }

  const next: StoredProfileOverrides = { ...current, updatedAt: new Date().toISOString() };
  if (args.name !== undefined) next.displayName = args.name;
  if (args.bio !== undefined) next.bio = args.bio;
  if (args.avatarUrl !== undefined) next.avatarUrl = args.avatarUrl;
  if (args.bannerUrl !== undefined) next.bannerUrl = args.bannerUrl;
  for (const field of args.clear ?? []) {
    if (field === 'name') delete next.displayName;
    else delete next[field];
  }

  await writeProfileOverrides(next);
  console.log('✓ Profile overrides updated for @' + handle);
  console.log(JSON.stringify(next, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
