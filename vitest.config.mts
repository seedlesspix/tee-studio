import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Smoke-test config. Default node environment (for the cut engine + server logic); the component
// test opts into happy-dom via a `// @vitest-environment happy-dom` comment at the top of its file.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    testTimeout: 20000, // sharp/potrace/paper can be slow on first load
  },
})
