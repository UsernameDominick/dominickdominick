import { withSecurityHeaders } from "./security-headers.js";

// The whole Worker: every request is answered from the static files in public/ (the index page, the stylesheet, robots.txt and whatever is added),
// with the site's security headers on top. This is the place to start: add a route above the last line, and keep the main module to handlers only
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
