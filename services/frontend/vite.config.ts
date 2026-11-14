import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = process.env.API_URL ?? "http://localhost:3000";

export default defineConfig({
  server: {
    port: 5173,
    proxy: { "/api": api },
  },
  plugins: [tanstackStart({ spa: { enabled: true } }), viteReact(), tailwindcss()],
});
