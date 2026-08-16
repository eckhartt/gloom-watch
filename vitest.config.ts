import { defineConfig } from "vitest/config";

/**
 * Deliberately separate from `vite.config.ts`: the test run has no business loading the PWA
 * plugin or the React refresh transform.
 *
 * Vitest is run through `bun --bun vitest` so a test can `import { Database } from "bun:sqlite"`.
 * `pool: "forks"` keeps each test file in its own process, which matches the production shape —
 * one SQLite connection per process — and sidesteps the cross-file mocked-clock state leak that
 * ruled `bun test` out.
 */
export default defineConfig({
	test: {
		environment: "node",
		include: ["tests/**/*.test.ts"],
		pool: "forks",
		clearMocks: true,
		restoreMocks: true,
	},
});
