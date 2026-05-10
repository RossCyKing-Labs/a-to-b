import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  // Public origin used for canonical URLs, OG tags, and the sitemap.
  // Swap this to a custom domain once you have one — until then we point at
  // the Cloudflare Workers free subdomain.
  site: 'https://a-to-b.rosscyking1115.workers.dev',
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
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
