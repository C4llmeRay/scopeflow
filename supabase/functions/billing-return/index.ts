/**
 * The bridge from Stripe's hosted page back into the app.
 *
 * Stripe will not redirect to a custom URI scheme: `success_url` has to be
 * http(s), so `scopeflow://billing` is rejected outright when the Checkout
 * session is created. This function is the https hop in between — Stripe sends
 * the browser here, and here sends it on to the app.
 *
 * It holds no secrets, reads no database and decides nothing. Landing on it
 * proves only that somebody finished (or abandoned) a Stripe page. What the
 * subscription actually became is the webhook's business.
 *
 * Deployed with:
 *   supabase functions deploy billing-return --no-verify-jwt
 *
 * The flag is required, not optional: this URL is opened by a browser coming
 * back from Stripe, which has no Supabase session to present.
 */

/** The app's own scheme, per app.json, plus what a dev build uses. */
const ALLOWED_PREFIXES = ['scopeflow://', 'exp://', 'http://localhost'];

const DEFAULT_TARGET = 'scopeflow://billing';

function safeTarget(candidate: string | null): string {
  if (!candidate) return DEFAULT_TARGET;
  // An open redirect on a public endpoint is worth avoiding even when the
  // endpoint looks boring: this URL will appear in Stripe receipts and browser
  // history, and it is trivially shareable.
  return ALLOWED_PREFIXES.some((prefix) => candidate.startsWith(prefix))
    ? candidate
    : DEFAULT_TARGET;
}

Deno.serve((request: Request) => {
  const url = new URL(request.url);
  const status = url.searchParams.get('status') === 'cancel' ? 'cancel' : 'success';
  const target = safeTarget(url.searchParams.get('to'));

  const separator = target.includes('?') ? '&' : '?';
  const deepLink = `${target}${separator}status=${status}`;

  // A meta refresh and a real link, not a 302.
  //
  // A 302 to a custom scheme is handled inconsistently — some in-app browsers
  // treat an unknown scheme in a redirect header as a network error and show a
  // dead page. Navigating from a loaded document is what the platforms actually
  // expect, and the visible link is the fallback for the case where even that
  // is blocked, so nobody is ever stranded on a blank screen holding a receipt.
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="0; url=${deepLink}">
<title>Returning to ScopeFlow</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 1.5rem; padding: 2rem;
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    text-align: center;
  }
  a {
    display: inline-block; padding: 0.875rem 1.5rem;
    border-radius: 0.75rem; background: #208AEF; color: #fff;
    text-decoration: none; font-weight: 600;
  }
</style>
</head>
<body>
  <p>Taking you back to ScopeFlow&hellip;</p>
  <a href="${deepLink}">Open ScopeFlow</a>
  <script>location.replace(${JSON.stringify(deepLink)});</script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Nothing here is worth caching, and a cached redirect to a stale deep
      // link is a genuinely confusing bug to chase.
      'Cache-Control': 'no-store',
    },
  });
});
