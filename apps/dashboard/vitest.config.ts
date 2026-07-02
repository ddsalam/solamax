import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Petakan alias "@/…" (tsconfig paths) agar test yang meng-import runtime dari
// "@/lib/*" (mis. model/doc builder yang memformat via @/lib/format) resolve.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
