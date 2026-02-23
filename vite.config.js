// vite.config.js
import { defineConfig } from "vite";

const isRender = process.env.RENDER === "true";

export default defineConfig({
  base: isRender ? "/" : "/tierlist-collab/",
  server: { allowedHosts: true },
});
