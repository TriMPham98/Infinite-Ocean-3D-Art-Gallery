// vite.config.js
import { defineConfig } from "vite";

export default defineConfig({
  base: "./", // Serve from the root path
  build: {
    outDir: "dist", // Output directory for production build
    assetsDir: "assets", // Directory for chunked assets
    rollupOptions: {
      output: {
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
      // Ensure static assets are copied to dist folder
      input: {
        main: "index.html",
        // Include references to any entry points or static files here
        // For example, static assets in public folder can be included here if they are not referenced in your index.html
      },
    },
  },
  resolve: {
    alias: {
      // Define any path aliases here
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
  // Include plugins if necessary
});
