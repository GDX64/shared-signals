import { defineConfig, mergeConfig } from "vitest/config";
import config from "./vite.config";

export default mergeConfig(
  config,
  defineConfig({
    test: {
      exclude: ["./tests/**/*.browser.test.ts"],
    },
  }),
);
