import { defineConfig } from "vitest/config";
import { resolve } from "path";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [dts()],
  build: {
    lib: {
      entry: resolve(__dirname, "./js/src/lib.ts"),
      name: "AnyStore",
      fileName: (format) => `lib.${format}.js`,
      formats: ["es"],
    },
  },
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  test: {
    environment: "node",
    benchmark: {},
    include: ["./js/tests/**/*.test.ts"],
  },
});
