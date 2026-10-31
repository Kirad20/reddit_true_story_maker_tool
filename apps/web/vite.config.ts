import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = process.env.API_ORIGIN ?? "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: api, changeOrigin: true },
      "/media": { target: api, changeOrigin: true },
      // Public legal pages are rendered by the API.
      "^/(terms|terminos|privacy|privacidad)(\\.html)?$": { target: api, changeOrigin: true },
    },
  },
});
