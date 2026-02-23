import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages (project pages) URL:
  // https://just1ssue.github.io/tierlist-collab/
  base: "/tierlist-collab/",
  server: {
    // Quick Tunnel (trycloudflare.com) からのアクセスを許可
    allowedHosts: true,
  },
});
