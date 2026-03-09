import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      "/ws": {
        target: process.env.VITE_SERVER_URL || "ws://localhost:8080",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
