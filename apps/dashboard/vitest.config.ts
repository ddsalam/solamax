import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Petakan alias "@/…" (tsconfig paths) agar test yang meng-import runtime dari
// "@/lib/*" (mis. model/doc builder yang memformat via @/lib/format) resolve.
export default defineConfig({
  // Komponen app memakai JSX runtime OTOMATIS (Next) — tanpa `import React`.
  // Default esbuild vitest = transform klasik → "React is not defined" begitu
  // sebuah test me-render komponen. Samakan dengan cara Next mengompilasinya.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
