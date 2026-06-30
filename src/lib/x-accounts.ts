/**
 * src/lib/x-accounts.ts
 *
 * Registry of the X accounts the app can post AS. Each account is one set
 * of OAuth 1.0a user tokens paired with the shared developer-app consumer
 * keys. Posting code resolves an account by id and builds a client from it.
 *
 *   owner → X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET           (your account)
 *   brand → X_BRAND_ACCESS_TOKEN / X_BRAND_ACCESS_TOKEN_SECRET (@ViralPulseX_AI)
 *
 * Brand tokens are obtained once via `npm run x:authorize`. An account only
 * appears in the registry if its tokens are present, so the posting UI
 * naturally shows just the accounts that are actually wired up.
 */

export type AccountId = 'owner' | 'brand';

export type PostingAccount = {
  id: AccountId;
  handle: string; // lowercase, no '@'
  label: string; // '@handle' for display
  appKey: string;
  appSecret: string;
  accessToken: string;
  accessSecret: string;
};

/** Public shape (no secrets) for sending account options to the client. */
export type AccountOption = { id: AccountId; handle: string; label: string };

export function getPostingAccounts(): PostingAccount[] {
  const appKey = process.env.X_CLIENT_ID;
  const appSecret = process.env.X_CLIENT_SECRET;
  if (!appKey || !appSecret) return [];

  const accounts: PostingAccount[] = [];

  if (process.env.X_ACCESS_TOKEN && process.env.X_ACCESS_TOKEN_SECRET) {
    const handle = (process.env.VP_OWNER_HANDLE ?? 'jlces').toLowerCase();
    accounts.push({
      id: 'owner',
      handle,
      label: `@${handle}`,
      appKey,
      appSecret,
      accessToken: process.env.X_ACCESS_TOKEN,
      accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
    });
  }

  if (process.env.X_BRAND_ACCESS_TOKEN && process.env.X_BRAND_ACCESS_TOKEN_SECRET) {
    const handle = (process.env.VP_BRAND_HANDLE ?? 'viralpulsex_ai').toLowerCase();
    accounts.push({
      id: 'brand',
      handle,
      label: `@${handle}`,
      appKey,
      appSecret,
      accessToken: process.env.X_BRAND_ACCESS_TOKEN,
      accessSecret: process.env.X_BRAND_ACCESS_TOKEN_SECRET,
    });
  }

  return accounts;
}

export function getPostingAccount(id: AccountId): PostingAccount | undefined {
  return getPostingAccounts().find((a) => a.id === id);
}

export function accountOptions(): AccountOption[] {
  return getPostingAccounts().map(({ id, handle, label }) => ({ id, handle, label }));
}
