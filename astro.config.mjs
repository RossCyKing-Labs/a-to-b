import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  // Public origin used for canonical URLs, OG tags, and the sitemap.
  site: 'https://fromatob.app',
  integrations: [
    react(),
    // Exclude the retired Word tool routes: they are noindex redirects to `/`
    // (see src/pages/word-to-pdf.astro), so they must not appear in the sitemap.
    sitemap({
      filter: (page) => !/\/(word-to-pdf|pdf-to-word)$/.test(page),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    // ES-module worker output is required for our compress worker because
    // @neslinesli93/qpdf-wasm uses dynamic imports to load its wasm binary;
    // IIFE (Vite's default) doesn't support that.
    worker: {
      format: 'es',
    },
  },
  build: {
    // Small stylesheets inline into HTML, large ones go external.
    inlineStylesheets: 'auto',
  },
  // Output static HTML — perfect for Cloudflare Workers static assets
  output: 'static',
  // No trailing slashes in URLs by default (cleaner)
  trailingSlash: 'never',
  // Note: we previously tried experimental.csp here. It generates hashes for
  // inline scripts/styles, which causes browsers to ignore 'unsafe-inline'
  // per CSP spec — which breaks React's runtime style={{...}} props. The
  // header-based CSP in public/_headers is the simpler, working approach
  // for a static site with React inline styling.
});
