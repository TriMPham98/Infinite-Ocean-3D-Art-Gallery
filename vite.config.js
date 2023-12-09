// vite.config.js
import { defineConfig } from "vite";

export default defineConfig({
  base: "./assets", // Set the base to the public path, adjust if necessary
  build: {
    assetsDir: "assets", // Keep assets within an assets directory
    rollupOptions: {
      // Configure Rollup options if necessary, for more control over the output structure
      output: {
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
  },
  // Include other configurations like plugins if needed
  // Add alias if you have specific rewriting rules for assets
  resolve: {
    alias: {
      // Add aliases if necessary
    },
  },
  // Include all your assets to the build
  assetsInclude: [
    "**/*.jpg",
    "**/*.png",
    "**/*.wav",
    "**/*.mp3",
    "**/*.ttf",
    "**/*.woff",
    "**/*.woff2",
  ],
  // Ensure to test this configuration locally by running `vite build` before deploying
});
