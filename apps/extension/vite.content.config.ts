import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "src/content.tsx"),
      name: "PinboardContent",
      formats: ["iife"],
      fileName: () => "assets/content.js",
      cssFileName: "assets/content"
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true
      }
    }
  }
});

