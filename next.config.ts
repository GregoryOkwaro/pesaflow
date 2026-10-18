import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Native argon2 binding must stay a runtime require, not be bundled.
  serverExternalPackages: ["@node-rs/argon2", "pg-boss"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
