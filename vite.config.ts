import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  plugins: [
    react(),
    tailwindcss(),
    cloudflare({
      configPath: process.env.STACKLET_CONFIG,
      persistState:
        process.env.STACKLET_E2E === "1" ? { path: ".wrangler/e2e" } : true,
    }),
  ],
});
