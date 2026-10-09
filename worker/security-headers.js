// The headers every response from the site carries: no MIME sniffing, no framing on other sites, a trimmed referrer, https only, and a content
// security policy with no inline script and no eval. Loosen the policy here when the new site needs something it forbids (a script from a CDN,
// an inline style, a frame), and keep the same list in public/_headers in step: that file covers what the asset store sends without the Worker.
export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // Closes the window where a first visit over plain http:// could be intercepted before the redirect to https:// happens.
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=()",
  "Content-Security-Policy": [
    "default-src 'self'",
    "img-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
    "form-action 'self'",
  ].join("; "),
};

export function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  // A response that already chose its own (stricter) policy keeps it.
  const ownCsp = headers.get("Content-Security-Policy");
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (name === "Content-Security-Policy" && ownCsp) continue;
    headers.set(name, value);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
