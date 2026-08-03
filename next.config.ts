import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Bundle the local font files into the cut-file lambda so opentype.js can read
  // them at runtime on Vercel. public/ is served statically and is NOT on the
  // serverless function's filesystem — without this the font fs.readFile 404s in
  // prod while working locally. Key = the route path (no /route suffix).
  outputFileTracingIncludes: {
    '/api/admin/cut-file': ['./public/fonts/**/*'],
    // The whole-order bundle route runs the same opentype.js generation, so it needs
    // the local fonts bundled into ITS lambda too — else local-font orders 404 in prod
    // while passing locally (the exact silent prod-only trap this key exists to prevent).
    '/api/admin/production-bundle': ['./public/fonts/**/*'],
  },
}

export default nextConfig
