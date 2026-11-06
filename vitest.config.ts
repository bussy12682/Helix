import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Frontend test runner (vitest + jsdom + Testing Library).
 *
 * Kept separate from the app's vite.config.ts on purpose: the lovable tanstack
 * config injects SSR/nitro plugins that have no role in unit tests. Only the
 * `@` → ./src alias is mirrored so components import exactly as in the app.
 *
 * Run with `npm run test:ui`; backend integration tests remain `npm test`.
 */
export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
