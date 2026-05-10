import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://a-to-b.pages.dev',
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
  build: {
    // Inline small stylesheets to avoid extra requests (helps with strict CSP)
    inlineStylesheets: 'auto',
  },
  // Output static HTML — perfect for Cloudflare Pages and our privacy posture
  output: 'static',
});
