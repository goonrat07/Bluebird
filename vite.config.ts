import { defineConfig } from 'vite';

// Relative base so the build works at https://<user>.github.io/<repo>/ without hardcoding the repo name.
export default defineConfig({
  base: './',
  // three.js alone is ~700 kB minified; raise the warning threshold rather than split it for now.
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
});
