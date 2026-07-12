# a → b

> A free, privacy-first file converter. Your files never leave your device.

**No accounts. No uploads. No tracking. No ads. No limits.** Every conversion runs
entirely in your browser — there is no upload endpoint on the site, so your files are
never sent anywhere.

**Live:** [fromatob.app](https://fromatob.app)

## Status

Shipped — **seven tools live**. See [`PLAN.md`](./PLAN.md) for the roadmap and
[`LAUNCH.md`](./LAUNCH.md) for the launch playbook.

## Tools

| Tool | What it does | Route |
|---|---|---|
| **Image** | PNG ↔ JPEG ↔ WebP (multi-file batch) | [`/image`](https://fromatob.app/image) |
| **Merge PDF** | Combine multiple PDFs into one | [`/merge-pdf`](https://fromatob.app/merge-pdf) |
| **Split PDF** | One PDF in, one PDF per page out | [`/split-pdf`](https://fromatob.app/split-pdf) |
| **JPG → PDF** | Bundle images into a PDF at a selectable page size | [`/jpg-to-pdf`](https://fromatob.app/jpg-to-pdf) |
| **PDF → JPG** | Render each page as a JPG at a chosen quality | [`/pdf-to-jpg`](https://fromatob.app/pdf-to-jpg) |
| **Rotate PDF** | 90° / 180° / 270° on every page | [`/rotate-pdf`](https://fromatob.app/rotate-pdf) |
| **Compress PDF** | Three-stage pipeline — mozjpeg image recompression, DPI-aware downsampling, and a qpdf-wasm structural pass. Text stays selectable. | [`/compress-pdf`](https://fromatob.app/compress-pdf) |

All conversion happens in the browser via the Canvas API,
[pdf-lib](https://pdf-lib.js.org/), [pdf.js](https://mozilla.github.io/pdf.js/),
[@neslinesli93/qpdf-wasm](https://github.com/neslinesli93/qpdf-wasm), and
[@jsquash/jpeg](https://github.com/jamsinclair/jSquash). There is no upload endpoint and
no server-side processing.

> **Why no Word ↔ PDF?** Microsoft Word and Google Docs already handle `.docx` ↔ PDF
> perfectly, for free. We can't match that fidelity in the browser without giving up the
> privacy promise, so we don't pretend to. Use Word's **Save As → PDF** or Google Docs's
> **File → Download → PDF**.

## How to verify the privacy claim

1. Open the site.
2. Open your browser's DevTools → **Network** tab.
3. Drop in a file and convert it.
4. Confirm **zero outbound network requests** during conversion.

If we ever break this, please [open an issue](https://github.com/rosscyking1115/a-to-b/issues).

## Tech stack

- **Astro 5** + React islands + TypeScript (strict)
- **Tailwind CSS v4**
- Hosted on **Cloudflare Workers** (static assets)
- **PWA** — installable, works offline after first load
- Conversion: `pdf-lib`, `pdf.js`, `@neslinesli93/qpdf-wasm` (Apache-2.0),
  `@jsquash/jpeg` (MIT, mozjpeg-WASM), native Canvas API
- Compress runs in a **Web Worker** so the UI stays responsive on large files

## Develop locally

Requires Node ≥ 20 and [pnpm](https://pnpm.io/) 9.

```bash
pnpm install       # install dependencies
pnpm dev           # start the dev server
pnpm check         # astro type check
pnpm test:run      # unit + component tests (Vitest)
pnpm test:e2e      # end-to-end tests (Playwright)
pnpm build         # production build to dist/
pnpm deploy        # build + deploy to Cloudflare Workers
```

## Contributing

Issues and PRs welcome. **The privacy posture is non-negotiable** — any change that adds
a third-party request, tracker, or upload endpoint will be rejected.

## Support

I'm **Cheng-Yuan King** — I built a → b in my spare time because I was tired of file
converters that upload your files to some random server. If it saved you time or a file,
that's the whole reward.

## License

Apache-2.0 © 2026 Cheng-Yuan King — see [`LICENSE`](./LICENSE).
