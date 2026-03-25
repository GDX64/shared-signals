import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  test: {
    include: ["./js/browser-tests/**/*.test.ts"],
    browser: {
      enabled: true,
      provider: playwright(),
      api: {
        port: 5175,
        strictPort: false,
      }, // https://vitest.dev/config/browser/playwright
      instances: [{ browser: "chromium", name: "chromium" }],
    },
  },
});
