import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The server's port. scripts/dev.mjs starts the server on SOUNDBOX_PORT and
// Vite inherits the same environment, so moving one moves the proxy with it.
const backend = `http://127.0.0.1:${process.env.SOUNDBOX_PORT || 17494}`;

// Reaching the dev UI from another machine or through a reverse proxy. Both are
// opt-in: the server has no authentication, and Vite proxies all of it.
//  - SOUNDBOX_DEV_HOST is the address Vite listens on (Vite's `server.host`;
//    `0.0.0.0` or a LAN IP). Unset, it stays on localhost.
//  - SOUNDBOX_ALLOWED_HOSTS (the same list the server reads) becomes Vite's
//    `server.allowedHosts`, which takes bare hostnames, so ports are dropped.
const devHost = process.env.SOUNDBOX_DEV_HOST?.trim() || undefined;
const allowedHosts = (process.env.SOUNDBOX_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean)
  .map((h) => {
    if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1 || undefined);
    const colon = h.indexOf(":");
    return colon !== -1 && h.indexOf(":", colon + 1) === -1 ? h.slice(0, colon) : h;
  });

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: Number(process.env.PORT) || 5174,
    host: devHost,
    allowedHosts,
    proxy: {
      // Everything under /api, /mcp, /files and /artwork is forwarded so the
      // app has no CORS story in dev.
      "/api": backend,
      "/mcp": backend,
      "/files": backend,
      "/artwork": backend,
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
