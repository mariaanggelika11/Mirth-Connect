import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(({ mode }) => {
  // Load environment variables sesuai mode (development / production)
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    root: "./",
    build: {
      outDir: "../server/public", // hasil build langsung ke server/public
      emptyOutDir: true,
      sourcemap: false,
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      port: Number(env.VITE_PORT) || 5173, // bisa ubah port lewat .env
      proxy: {
        "/api": {
          target: env.VITE_API_URL || "http://localhost:9000",
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});
