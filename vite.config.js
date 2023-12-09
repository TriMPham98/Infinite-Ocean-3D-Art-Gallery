// vite.config.js
import { defineConfig } from "vite";

export default defineConfig({
  base: "./", // Adjust this path if your app is not served from the root
  build: {
    assetsDir: "assets", // Keep assets within an assets directory
    rollupOptions: {
      output: {
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
  },
  resolve: {
    alias: {
      // Add aliases if necessary
    },
  },
  assetsInclude: [
    "**/*.jpg",
    "**/*.png",
    "**/*.wav",
    "**/*.mp3",
    "**/*.ttf",
    "**/*.woff",
    "**/*.woff2",
  ],
});
