# a → b *(working name)*

A free, privacy-first file converter. Files never leave your device.

> Converts a → b. Nothing else. No accounts. No uploads. No tracking. No ads. No limits.

**Live:** [a-to-b.rosscyking1115.workers.dev](https://a-to-b.rosscyking1115.workers.dev)

## Status

v1 shipped — all three converters live. See [`PLAN.md`](./PLAN.md) for the full roadmap and what's next.

## What it does

- PNG ↔ JPEG ↔ WebP (multi-file batch)
- DOCX → PDF (browser print, selectable text)
- PDF → DOCX *(text + bold/italic + hyperlinks; layout best-effort)*

All conversion happens in the user's browser via Canvas API and WebAssembly. There is no upload endpoint. There is no server-side processing.

## How to verify the privacy claim

1. Open the site
2. Open your browser's DevTools → Network tab
3. Drop in a file and convert it
4. Confirm zero outbound network requests during conversion

If we ever break this, please open an issue.

## Tech stack

- Astro 5 + React islands + TypeScript (strict)
- Tailwind CSS v4
- Hosted on Cloudflare Workers (static assets)
- PWA: installable, works offline after first load
- Conversion libraries: `pdf.js`, `mammoth`, `docx`, native Canvas API

## Contributing

Issues and PRs welcome once the repo is public. The privacy posture is non-negotiable — any change that adds a third-party request, tracker, or upload endpoint will be rejected.

## Support

If this saved you time, you can [buy me a coffee ☕](https://ko-fi.com/rosscyking). Not required, never asked twice.

## License

MIT — see [`LICENSE`](./LICENSE).
