# a → b *(working name)*

A free, privacy-first file converter. Files never leave your device.

> Converts a → b. Nothing else. No accounts. No uploads. No tracking. No ads. No limits.

**Live:** [fromatob.app](https://fromatob.app) &nbsp;·&nbsp; [![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/rosscyking)

## Status

Shipped — seven tools live. See [`PLAN.md`](./PLAN.md) for the roadmap and what's next.

## What it does

**Image**

- PNG ↔ JPEG ↔ WebP (multi-file batch)

**PDF**

- **Merge** — combine multiple PDFs into one
- **Split** — one PDF in, one PDF per page out
- **JPG → PDF** — bundle images into a PDF with selectable page size
- **PDF → JPG** — render each page as a JPG at a chosen quality
- **Rotate** — 90° / 180° / 270° on every page
- **Compress** — three-stage pipeline (mozjpeg image recompression, DPI-aware downsampling, qpdf-wasm structural pass). Text stays selectable.

All conversion happens in the user's browser via the Canvas API, [pdf-lib](https://pdf-lib.js.org/), [pdf.js](https://mozilla.github.io/pdf.js/), [@neslinesli93/qpdf-wasm](https://github.com/neslinesli93/qpdf-wasm), and [@jsquash/jpeg](https://github.com/jamsinclair/jSquash). There is no upload endpoint. There is no server-side processing.

> Why no Word ↔ PDF? Microsoft Word and Google Docs already handle `.docx` ↔ PDF perfectly, for free. We can't match that fidelity in the browser without giving up the privacy promise, so we don't pretend to. Use Word's **Save As → PDF** or Google Docs's **File → Download → PDF**.

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
- Conversion: `pdf-lib`, `pdf.js`, `@neslinesli93/qpdf-wasm` (Apache-2.0), `@jsquash/jpeg` (MIT, mozjpeg-WASM), native Canvas API
- Compress runs in a Web Worker so the UI stays responsive on large files

## Contributing

Issues and PRs welcome. The privacy posture is non-negotiable — any change that adds a third-party request, tracker, or upload endpoint will be rejected.

## Support

I'm Ross — I built a → b in my spare time because I was tired of file converters that upload your files to some random server. If this saved you time or a file, a coffee means a lot and helps me justify the hours.

[☕ Buy me a coffee on Ko-fi](https://ko-fi.com/rosscyking)

## License

MIT — see [`LICENSE`](./LICENSE).
