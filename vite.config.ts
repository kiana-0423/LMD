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
      target: "es2020",
      // Written so `scripts/analyze-bundle.mjs` can work out which chunks the browser loads before
      // it can render anything, rather than guessing from file names.
      manifest: true,
      // Deliberately left at Vite's default. Raising it would silence the warning about Ketcher's
      // bundled template library without making the file any smaller; the analysis script reports
      // the real sizes and fails on a budget instead.
      rollupOptions: {
        output: {
          // Assets keep their source name, so `indigo-ketcher-norender-1.42.0.wasm` is
          // recognisable in a build listing rather than an opaque hash.
          assetFileNames: "assets/[name]-[hash][extname]"
        }
      }
    }
  };
});
