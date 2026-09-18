import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Base path is configurable so the same build works on a user/org GitHub Pages
// site, a project page (https://<user>.github.io/SensoryDataMaps/), Netlify, or
// a plain static host. Default to relative paths, which work in all of those.
const base = process.env.VITE_BASE ?? "./";

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [react()],
});
