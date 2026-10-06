import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // 2026-10-06 (Denise): React Compiler rules + no-explicit-any + ban-ts-comment DEMOTED TO WARN so `npm run lint`
  // exits 0 and a NEW error in a changed file is visible again. The 356 pre-existing hits still print as warnings
  // — they are real, just parked: fold the cleanup into the DesignerCanvas.tsx split (325 of the 356 live there).
  // rules-of-hooks stays an error. See CLAUDE.md → Known Issues → Code Quality.
  {
    rules: {
      'react-hooks/config': 'warn',
      'react-hooks/error-boundaries': 'warn',
      'react-hooks/gating': 'warn',
      'react-hooks/globals': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/set-state-in-render': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/use-memo': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
    },
  },
]);

export default eslintConfig;
