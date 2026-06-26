import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  envDir: "../..",
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "src/injected.ts"),
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
