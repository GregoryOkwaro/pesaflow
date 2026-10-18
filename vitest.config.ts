import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globalSetup: ["./src/test/globalSetup.ts"],
    setupFiles: ["./src/test/setup.ts"],
    // DB tests share one database; run files one at a time.
    fileParallelism: false,
    testTimeout: 20000,
  },
});
