// GET /api/r/x?text=...
//
// Smart redirect that opens the right surface depending on device:
//   • Mobile UA (iOS / Android) → HTML page with JS that fires
//     `location.href = "twitter://post?message=…"`, which the OS hands to
//     the X app. Includes a visible fallback link to the web composer.
//   • Everything else (desktop, bots, unknown) → 302 to x.com/intent/post.
//
// Why this exists: Telegram strips `twitter://` URLs out of formatted
// message links across every parse mode (Markdown, MarkdownV2, HTML).
// The only way to get the X app to open from a Telegram tap is to embed
// an HTTPS link Telegram preserves, and let the *server* do the scheme
// swap to `twitter://` once the user taps through.
//
// This route is deliberately read-only and stateless. It takes one query
// param, builds the redirect target, returns. No DB, no auth, no logging
// of message bodies.
import { NextRequest, NextResponse } from 'next/server';

const MOBILE_UA_RE = /android|iphone|ipad|ipod|mobile/i;

export function GET(req: NextRequest) {
  const text = req.nextUrl.searchParams.get('text') ?? '';
  if (!text) {
    return NextResponse.json(
      { error: 'Missing required query param "text"' },
      { status: 400 },
    );
  }

  const ua = req.headers.get('user-agent') ?? '';
  const isMobile = MOBILE_UA_RE.test(ua);

  // Both URLs use the same encoded text — encodeURIComponent is enough
  // since neither URL embeds in Markdown here (no paren-encoding needed).
  const enc = encodeURIComponent(text);
  const appUrl = `twitter://post?message=${enc}`;
  const webUrl = `https://x.com/intent/post?text=${enc}`;

  if (!isMobile) {
    // Desktop / unknown: straight redirect to web composer
    return NextResponse.redirect(webUrl, 302);
  }

  // Mobile: serve a one-shot HTML page that tries the native app, falls back
  // to web after a brief delay (if no app handler intercepts the navigation).
  // The escaped attribute insertion is safe because we only put the encoded
  // text into href attributes that already require URL-encoding.
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Opening X…</title>
  <style>
    html, body { margin: 0; padding: 0; height: 100%; background: #000; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .wrap { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; padding: 24px; text-align: center; gap: 20px; }
    h1 { font-size: 20px; font-weight: 600; margin: 0; }
    p { font-size: 14px; opacity: 0.7; margin: 0; max-width: 320px; line-height: 1.5; }
    a.btn { display: inline-block; padding: 14px 28px; background: #1d9bf0; color: #fff; text-decoration: none; border-radius: 999px; font-weight: 600; font-size: 15px; }
    a.alt { color: #1d9bf0; text-decoration: none; font-size: 14px; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Opening X…</h1>
    <p>If the X app didn't open automatically, tap the button below.</p>
    <a class="btn" href="${appUrl}">Open X app</a>
    <a class="alt" href="${webUrl}">Or use the web composer →</a>
  </div>
  <script>
    // Try the native handler immediately. If the X app intercepts the
    // navigation, this page never finishes loading from the user's view.
    // If nothing handles twitter://, the buttons above remain tappable.
    setTimeout(function () { window.location.href = ${JSON.stringify(appUrl)}; }, 50);
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
