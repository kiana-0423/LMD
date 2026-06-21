import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const devServerPort = Number(env.VITE_DEV_SERVER_PORT ?? 1420);

  return {
    plugins: [react()],
    clearScreen: false,
    define: {
      global: "globalThis"
    },
    server: {
      port: devServerPort,
      strictPort: true
    },
    envPrefix: ["VITE_", "TAURI_"],
    test: {
      setupFiles: ["./src/__tests__/setup.ts"]
    },
    build: {
      target: "es2020"
    }
  };
});
