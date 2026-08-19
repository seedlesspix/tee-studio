import type { NextConfig } from 'next'

// sharp's native binary is split across two @img packages: @img/sharp-linux-x64 (sharp.node) and
// @img/sharp-libvips-linux-x64 (libvips-cpp.so). Vercel's file tracer follows require() and bundles
// sharp.node, but sharp dlopen()s the libvips .so at RUNTIME — a dynamic load the tracer can't follow —
// so the .so is left out and the function 500s with "libvips-cpp.so...: cannot open shared object file".
// Force-include both (all platform variants; the glob simply matches nothing on the wrong platform) for
// every route that uses sharp. Same class of fix as the fonts below (read at runtime, not required).
const SHARP_NATIVE = [
  './node_modules/**/@img/sharp-linux-x64/**/*',
  './node_modules/**/@img/sharp-libvips-linux-x64/**/*',
  './node_modules/**/@img/sharp-linuxmusl-x64/**/*',
  './node_modules/**/@img/sharp-libvips-linuxmusl-x64/**/*',
]

const nextConfig: NextConfig = {
  serverExternalPackages: ['paper-jsdom', 'jsdom', 'sharp', 'potrace'],
  // Bundle the local font files into the cut-file lambda so opentype.js can read
  // them at runtime on Vercel. public/ is served statically and is NOT on the
  // serverless function's filesystem — without this the font fs.readFile 404s in
  // prod while working locally. Key = the route path (no /route suffix).
  outputFileTracingIncludes: {
    '/api/admin/cut-file': ['./public/fonts/**/*'],
    // The whole-order bundle route runs the same opentype.js generation, so it needs
    // the local fonts bundled into ITS lambda too — else local-font orders 404 in prod
    // while passing locally (the exact silent prod-only trap this key exists to prevent).
    // It ALSO uses sharp (previews/originals/auto-trace) → force-include sharp's native binary.
    '/api/admin/production-bundle': ['./public/fonts/**/*', ...SHARP_NATIVE],
    // Customer cut-edge preview traces uploads with sharp+potrace too.
    '/api/trace-preview': [...SHARP_NATIVE],
  },
}

export default nextConfig
