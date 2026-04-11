import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist/main",
      lib: {
        entry: "src/main/index.ts",
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist/preload",
      lib: {
        entry: "src/preload/index.ts",
      },
    },
  },
  renderer: {
    plugins: [react()],
    root: "src/renderer",
    build: {
      outDir: "../../dist/renderer",
      rollupOptions: {
        input: "src/renderer/index.html",
      },
    },
  },
});
