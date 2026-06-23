// POST /api/post-to-x   { text: string, imageUrl?: string, oppId?: string }
//
// Posts a tweet to X via OAuth 1.0a User Context. Returns { tweetId, url }
// on success, or { error } with a descriptive message on failure.
//
// If oppId is provided, the corresponding opportunity is removed from the
// store on success — same UX as "Use Draft" already has when the user
// approves a draft from the modal.
import { NextResponse } from 'next/server';
import { postToX, isPostingConfigured } from '@/lib/x-poster';
import { removeOpportunity } from '@/store/opportunity-store';

export async function POST(req: Request) {
  // Early guard — gives a clear error before we try to build a client
  if (!isPostingConfigured()) {
    return NextResponse.json(
      {
        success: false,
        error:
          'X posting is not configured. Add X_ACCESS_TOKEN and X_ACCESS_TOKEN_SECRET to .env.local. See src/lib/x-poster.ts header for setup steps.',
        configured: false,
      },
      { status: 503 },
    );
  }

  // ── Parse + validate body
  let body: { text?: string; imageUrl?: string; oppId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const text = (body.text ?? '').trim();
  const imageUrl = body.imageUrl?.trim() || undefined;
  const oppId = body.oppId?.trim() || undefined;

  if (!text) {
    return NextResponse.json(
      { success: false, error: 'text is required' },
      { status: 400 },
    );
  }
  if (text.length > 280) {
    return NextResponse.json(
      { success: false, error: `Tweet is ${text.length} chars — max 280` },
      { status: 400 },
    );
  }
  if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
    return NextResponse.json(
      { success: false, error: 'imageUrl must be a fully-qualified http(s) URL' },
      { status: 400 },
    );
  }

  // ── Post
  try {
    const result = await postToX({ text, imageUrl });

    // Side effect — drop the source opportunity from the store on success.
    // Same intent as the existing "Use Draft" flow in the modal.
    if (oppId) {
      try {
        await removeOpportunity(oppId);
      } catch (err) {
        // Don't fail the response — the tweet is already out.
        console.error('Failed to remove opportunity after post:', err);
      }
    }

    return NextResponse.json({
      success: true,
      tweetId: result.tweetId,
      url: result.url,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message ?? 'Unknown posting error' },
      { status: 500 },
    );
  }
}

/**
 * GET /api/post-to-x — light status probe used by the dashboard to decide
 * whether to enable the Post Now button. Returns { configured: boolean }.
 */
export async function GET() {
  return NextResponse.json({ configured: isPostingConfigured() });
}
