// vite.config.js
import { defineConfig } from "vite";

export default defineConfig({
  base: "", // Changed from "./" to "" to ensure paths are resolved correctly in any hosting environment
  build: {
    outDir: "dist", // Output directory for build files
    assetsDir: "assets", // Subdirectory under dist for assets (this is relative to outDir)
    rollupOptions: {
      output: {
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
      // If you have multiple entry points, list them here
    },
  },
  resolve: {
    alias: {
      // Define any aliases here
    },
  },
  // Plugins can be added here if needed
});
