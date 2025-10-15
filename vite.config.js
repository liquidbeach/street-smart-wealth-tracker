import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // auto-update the service worker when you push a new build
      registerType: "autoUpdate",

      // only include assets you actually have in /public
      includeAssets: ["icon-192.png", "icon-512.png"],
      injectRegister: "auto",
      registerType: "autoUpdate",
      manifest: {
        name: "Street-Smart Wealth Tracker",
        short_name: "Wealth Tracker",
        start_url: "/",
        display: "standalone",
        background_color: "#0f172a",
        theme_color: "#0f172a",
        orientation: "portrait-primary",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" }
        ]
      },
      // sensible defaults: cache static assets; let HTML go to network
      workbox: {
        navigateFallback: "/index.html",
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"]
      }
    })
  ],

  // keep your alias
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } }
});