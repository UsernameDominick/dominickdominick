import { withSecurityHeaders } from "./security-headers.js";

// The whole Worker. A request for a file that exists in public/ (the index page, the stylesheet, robots.txt and whatever is added) is answered by the
// asset store itself and never gets here (its headers are in public/_headers); this answers everything else from the same files (so a missing
// address is a 404) with the site's security headers on top. This is the place to start: add a route above the last line, and keep the main module to handlers only
// (put anything else in its own file, as security-headers.js is).
export default {
  async fetch(request, env) {
    try {
      return withSecurityHeaders(await env.ASSETS.fetch(request));
    } catch (err) {
      return withSecurityHeaders(new Response("Something went wrong. Try again in a moment.", { status: 500, headers: { "Content-Type": "text/plain;charset=UTF-8" } }));
    }
  },
};
