import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev port (devUrl in src-tauri/tauri.conf.json).
// `strictPort` makes Vite fail instead of silently picking another port.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    // The Rust side rebuilds on its own; don't let Vite watch it.
    watch: { ignored: ["**/src-tauri/**", "**/crates/**", "**/target/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    // WebView2 on Windows is evergreen Chromium.
    target: "chrome110",
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
