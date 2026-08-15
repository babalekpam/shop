import { defineConfig } from 'vitest/config';

/**
 * Next rewrites the root tsconfig's `jsx` to `preserve`, because it applies its own
 * optimised transform at build time. Vitest does not run that transform, so the component
 * tests would reach the bundler as raw JSX and fail to parse.
 *
 * `tests/tsconfig.json` sets `jsx: react-jsx` for the test files only. That keeps one
 * source of truth for the app build and one for the tests, without fighting Next over a
 * file it rewrites on every build.
 */
export default defineConfig({
  // Vitest 4 transforms with oxc, so this is the knob that applies (an `esbuild`
  // block is accepted and then ignored, which is a quiet way to stay broken).
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
