import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Single-file content script build.
// - IIFE output so it runs directly as a Manifest V3 content script.
// - inlineDynamicImports keeps everything in one `content.js`.
// - CSS is imported with `?inline` in the source and injected into a Shadow
//   root at runtime, so no separate CSS asset is emitted or needed in the manifest.
// - `public/` (manifest.json, icons) is copied to `dist/` verbatim by Vite.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2021',
    minify: false,
    rollupOptions: {
      input: {
        content: resolve(__dirname, 'src/content.ts'),
      },
      output: {
        format: 'iife',
        entryFileNames: '[name].js',
        inlineDynamicImports: true,
      },
    },
  },
});
