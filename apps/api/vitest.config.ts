import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Points DATA_DIR at a temp folder so tests never touch the real data/ (settings, secrets).
    setupFiles: ["./test/setup.ts"],
  },
});
