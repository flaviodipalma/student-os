import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

// Browser protections for every response (see docs/security.md).
//
// Content Security Policy, following Next's "without nonces" setup: scripts,
// styles, fonts and requests only from this site (inline allowed for the theme
// script and Next's own), no plugins, no framing. Pages never talk to other
// origins from the browser: Supabase, Claude, Google, Microsoft, Canvas and
// Blackboard are only called from the server. `form-action` is left out on
// purpose: signing in or connecting a calendar ends in a redirect to Google /
// Microsoft / Apple / the LMS, which it would block before JavaScript loads.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  ...(isProduction ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  // Older browsers' equivalent of frame-ancestors 'none' (no clickjacking).
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Links to Canvas / Google / ... get the origin only, never a page path with ids.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // HTTPS only, once deployed (never on http://localhost).
  ...(isProduction ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
