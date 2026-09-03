import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// La Mini App è servita da GitHub Pages sotto /sambelli/.
export default defineConfig({
  base: process.env.VITE_BASE ?? "/sambelli/",
  plugins: [react(), tailwindcss()],
  server: {
    // dates.ts è condiviso con le Edge Functions, fuori dalla cartella web/.
    fs: { allow: [".."] },
  },
});
