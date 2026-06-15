import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Alias workspace dep ke source TS agar test jalan tanpa build dulu.
export default defineConfig({
  resolve: {
    alias: {
      "@solamax/shared": resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
  test: {
    environment: "node",
  },
});
