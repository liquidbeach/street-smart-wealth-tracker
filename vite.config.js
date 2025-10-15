import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["/icon-192.png", "/icon-512.png"],
      manifest: {
        name: "Street-Smart Wealth Tracker",
        short_name: "Wealth",
        start_url: "/",
        display: "standalone",
        background_color: "#f1f5f9",
        theme_color: "#0f172a",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" }
        ]
      },
      workbox: {
        // Good defaults: cache static assets, fall back to network for HTML
        navigateFallback: "/index.html"
      }
    })
  ],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } }
});