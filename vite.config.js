// vite.config.js
import { defineConfig } from "vite";

export default defineConfig({
  // Root-absolute base so assets resolve correctly on Vercel (and local dev)
  base: "/",
  build: {
    outDir: "dist",
    assetsDir: "assets",
    rollupOptions: {
      output: {
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
  },
});
