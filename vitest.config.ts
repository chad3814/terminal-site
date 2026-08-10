import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules/**", ".next/**", "e2e/**"],
  },
  // Pinned explicitly rather than left to tsconfig: Next rewrites tsconfig.json's
  // `jsx` value on build (it has flipped from "preserve" to "react-jsx" before), and
  // if esbuild ever fell back to a "preserve"-like setting it would emit JSX
  // untransformed and every .tsx test would fail to parse. Keeping this override
  // makes the test runner's JSX handling independent of whatever Next's build step
  // has most recently written to tsconfig.json.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
