import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Bundle the local font files into the cut-file lambda so opentype.js can read
  // them at runtime on Vercel. public/ is served statically and is NOT on the
  // serverless function's filesystem — without this the font fs.readFile 404s in
  // prod while working locally. Key = the route path (no /route suffix).
  outputFileTracingIncludes: {
    '/api/admin/cut-file': ['./public/fonts/**/*'],
  },
}

export default nextConfig
