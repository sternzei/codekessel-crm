import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const isProd = process.env.NODE_ENV === "production";

// Baseline security headers (web/security.md). The app is self-contained:
// no third-party scripts, no external fonts/CDNs, mock messaging adapters
// only talk to the DB. So the CSP can be tight.
//
// TODO(nonce): script-src/style-src still allow 'unsafe-inline'. The App
// Router injects inline bootstrap scripts and the UI uses inline `style`
// attributes; moving to per-request nonces requires a proxy.ts that stamps
// the nonce header and threads it into <Script>. Tracked for post-MVP.
const scriptSrc = isProd
  ? "'self' 'unsafe-inline'"
  : "'self' 'unsafe-inline' 'unsafe-eval'"; // dev/HMR needs eval

const csp = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  // HSTS only meaningful over HTTPS; harmless locally, required in prod.
  ...(isProd
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains; preload",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle (.next/standalone/server.js) so the
  // production Docker image can run the web tier without the full node_modules.
  output: "standalone",
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);
