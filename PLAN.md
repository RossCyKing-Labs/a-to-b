# a → b — Project Plan

A privacy-first, free file conversion web app. Files never leave the user's device. No ads, no upload limits, no tracking. Optional "Buy me a coffee" tip jar.

> **Working name:** a → b. Final name TBD (a few candidates at the bottom of this doc).
>
> **Live:** [a-to-b.rosscyking1115.workers.dev](https://a-to-b.rosscyking1115.workers.dev)
>
> **Repo:** [github.com/rosscyking1115/a-to-b](https://github.com/rosscyking1115/a-to-b)

## Status — May 2026

| Phase | What | Status |
|---|---|---|
| 0 | Foundations: Astro 5 + Tailwind 4 + TS strict, Cloudflare Pages, strict CSP, sitemap | ✅ Shipped |
| 1 | Image converter: PNG ↔ JPEG ↔ WebP, multi-file batch, magic-byte validation | ✅ Shipped |
| 2 | Word → PDF via mammoth + browser print, in-page preview, selectable text output | ✅ Shipped |
| 3 | PDF → Word via pdf.js + docx, paragraph reconstruction, heading/list detection | ✅ Shipped |
| 3.5 | Bold/italic + hyperlink preservation in PDF→Word output | ✅ Shipped |
| 4 | PWA (offline + installable), 404 page, Buy Me a Coffee link | ✅ Shipped |
| 5+ | Future formats (PDF tools, audio, video, etc.) | Deferred until users ask |

---

## 1. Doability Verdict

**Overall:** Yes — very doable. None of this requires a backend, custom AI, or research. It's all assembly of mature browser primitives and existing libraries.

| Conversion | Difficulty | Open-source path exists? | Confidence |
|---|---|---|---|
| PNG ↔ JPEG ↔ WebP/AVIF | Trivial | Yes (native Canvas API + jSquash for AVIF) | Very high |
| DOCX → PDF | Medium | Yes (mammoth.js → HTML → pdf-lib / @react-pdf) | High |
| PDF → DOCX | **Hard** | Yes, with caveats (PDF.js text extraction → docx library) — text-faithful, layout-lossy | Medium |

The honest catch is PDF → Word. The mature commercial libraries (Nutrient, Apryse, Spire) cost real money and aren't open source. The free, fully client-side path produces a Word doc you can edit, but it won't perfectly preserve complex multi-column layouts or scanned PDFs (those need OCR). For 80% of real-world PDFs (text-heavy reports, contracts, articles), the free path is good enough — and it can be honestly labeled as such. We can add OCR via Tesseract.js as a Phase 4 add-on.

---

## 2. Tech Stack (locked in based on your answers)

| Layer | Choice | Why |
|---|---|---|
| Framework | **Astro 5** with React islands | Best static performance on Cloudflare Pages; Cloudflare acquired Astro Jan 2026, deepest integration. React islands for the interactive converter widgets. |
| Language | TypeScript (strict) | Catches the "is this a Blob or a File?" class of bugs that plague file-handling code. |
| Styling | Tailwind CSS v4 + shadcn/ui (vendored) | Fast, modern, no runtime cost. Vendor shadcn so we don't ship a heavy component library. |
| Package manager | pnpm | Faster, disk-efficient. |
| Hosting | Cloudflare Pages | Generous free tier, global CDN, free subdomain `<name>.pages.dev`. |
| CI | GitHub Actions → Cloudflare Pages deploy | Standard. |
| Analytics | **None initially.** Plausible (self-hosted on a free Worker) if needed later. | Anything else breaks the privacy promise. |
| Error tracking | None client-side. Server logs only. | Sentry et al. would phone home with file metadata — incompatible with the pitch. |

### Conversion Library Choices

| Conversion | Primary library | Fallback / notes |
|---|---|---|
| PNG/JPEG/WebP encode/decode | Native Canvas `toBlob()` | Built into every browser. Zero dependency. |
| Better-quality JPEG | `@jsquash/jpeg` (MozJPEG WASM) | 10–20% smaller files at same quality. ~200KB WASM. |
| AVIF support (Phase 4) | `@jsquash/avif` | Optional add-on. |
| DOCX → HTML | `mammoth` (MIT) | Mature, widely used. |
| HTML → PDF | `pdf-lib` + a layout pass we write, OR browser `window.print()` to PDF | `pdf-lib` gives more control; print-to-PDF is more accurate for complex layouts. We'll prototype both in Phase 2. |
| PDF parsing | `pdf.js` (Mozilla, Apache-2) | The reference implementation. |
| DOCX writing | `docx` (npm package, MIT) | Solid open-source DOCX writer. |
| OCR (Phase 4) | `tesseract.js` | For scanned PDFs. Heavy (~2MB WASM) — lazy-loaded only when user opts in. |

### What we are explicitly NOT using and why

- **Nutrient / Apryse / Spire SDKs** — paid, license-restricted, against the "free forever" pitch.
- **LibreOffice WASM (ZetaOffice)** — ~250 MB initial download. Would destroy the "fast loading" goal. Revisit in 2027 if it slims down.
- **CDNs that log (jsDelivr, unpkg) at runtime** — bundle everything at build time. Self-hosted assets only.
- **Google Fonts via `<link>`** — phones home. Self-host fonts (Fontsource).

---

## 3. Privacy Posture (the differentiator)

This is the marketing pitch *and* the engineering constraint. Every decision has to pass "does this break the privacy promise?"

**Hard guarantees we will be able to truthfully claim:**

1. **No file ever leaves the device.** All conversion runs in WASM/JS in the user's browser. There is no upload endpoint to send files to.
2. **No tracking.** No Google Analytics, no Meta Pixel, no Sentry, no third-party scripts. Period.
3. **No cookies for tracking.** Only essential preference storage in `localStorage` (theme, last-used format) — and even that is documented.
4. **No third-party requests at runtime.** Self-host fonts, icons, all assets. Strict CSP that blocks everything outside our own origin.
5. **Open source.** Repo is public. Anyone can audit. Reproducible builds via locked pnpm versions.
6. **Verifiable.** We will publish a one-line claim users can check: open DevTools → Network tab → drag in a file → confirm zero outbound requests during conversion.

**Soft commitments (nice to have, harder to enforce):**

- Subresource Integrity (SRI) on every script tag.
- Content Security Policy: `default-src 'self'; connect-src 'none';`
- Add a "Verify privacy" button that opens DevTools-friendly instructions.

---

## 4. Phased Roadmap

Each phase is shippable on its own. Don't wait for everything before launching.

### Phase 0 — Foundations *(1–2 evenings)*

Goal: a deployed, branded, empty site at `atob.pages.dev` (or whatever name we land on).

- [ ] Initialize Astro 5 + Tailwind v4 + TypeScript project in this folder
- [ ] Set up pnpm, .editorconfig, prettier, eslint
- [ ] Create `/`, `/about`, `/privacy` routes with placeholder content
- [ ] Design system: pick 2–3 fonts (self-hosted), color palette, build a tiny component library (`Button`, `FileDrop`, `FormatPicker`, `ProgressBar`)
- [ ] Strict CSP via `_headers` file (Cloudflare Pages native support)
- [ ] GitHub repo + Actions workflow → Cloudflare Pages
- [ ] First deploy. Confirm zero third-party requests in DevTools.

**Exit criteria:** site is live, shows "AtoB — coming soon," loads with Lighthouse 100/100/100/100.

### Phase 1 — Image conversions *(2–3 evenings)* ← **ship first**

Why first: easiest, validates the whole pipeline (drop file → convert → download), proves the privacy claim works, gets you a real shippable thing fast.

- [ ] Build the core `<FileDrop>` React island: drag-drop + click-to-select + keyboard accessible
- [ ] Build `<FormatPicker>` (radio group for output format)
- [ ] Image converter route: `/image`
  - PNG → JPEG, JPEG → PNG, PNG → WebP, JPEG → WebP, WebP → PNG/JPEG
  - Quality slider for JPEG/WebP
  - Preserve filename (`photo.png` → `photo.jpg`)
- [ ] Multi-file support — drop 50 files, get a zip back (use `jszip`, also client-side)
- [ ] Optional: integrate `@jsquash/jpeg` for higher-quality JPEG output
- [ ] Mobile testing: iOS Safari, Chrome Android. Drag-drop falls back to file picker.
- [ ] Lighthouse 95+ on every metric

**Exit criteria:** image conversion works end-to-end, no upload happens (verify in Network tab), under 3-second time-to-interactive on 4G.

### Phase 2 — Word → PDF *(3–5 evenings)*

- [ ] DOCX parsing with `mammoth` to clean HTML
- [ ] Decision spike: compare two approaches side-by-side
  - **A:** Mammoth → HTML → render in hidden iframe → `window.print()` with a custom CSS print stylesheet → user gets browser's "Save as PDF" dialog
  - **B:** Mammoth → HTML → manually layout with `pdf-lib`
  - Test both with: simple memo, multi-page report, doc with images, doc with tables, doc with headers/footers
- [ ] Pick whichever produces fewer surprises. Document what *doesn't* round-trip (e.g., complex tables, embedded objects)
- [ ] Route: `/word-to-pdf`
- [ ] Honest about limits — "Fonts and complex tables may render slightly differently"

**Exit criteria:** common-case .docx → .pdf works visibly correctly. Edge cases documented.

### Phase 3 — PDF → Word *(5–8 evenings — the hard one)*

- [ ] Use `pdf.js` to extract text + position data per page
- [ ] Heuristic structural pass: group runs into paragraphs, detect headings by font size, detect lists by bullet/number prefix
- [ ] Use `docx` library to emit a real .docx
- [ ] Be explicit in UI about what's lossy: layout, exact fonts, scanned PDFs (need OCR)
- [ ] If output quality is poor on common docs, set expectations clearly in UI ("Best for text-heavy PDFs")
- [ ] Route: `/pdf-to-word`

**Exit criteria:** for a contract, a CV, a research paper, the output Word doc is editable and the text is faithful even if the layout isn't pixel-perfect.

### Phase 4 — Polish, PWA, launch *(2–4 evenings)*

- [ ] PWA manifest + service worker → installable, fully offline after first load
- [ ] Dark mode (CSS-only, respects `prefers-color-scheme`)
- [ ] i18n scaffolding (start English-only, but build in the seam)
- [ ] "Buy me a coffee" link in footer (Ko-fi or BMAC, both privacy-respecting)
- [ ] SEO: meta tags, sitemap, OG images per route
- [ ] Public launch: HN Show, Reddit r/selfhosted, r/privacy, Product Hunt (privacy-tools category)

### Phase 5+ — Future formats (nice-to-have, only when demand exists)

In rough priority order based on common requests for converters:

1. PDF tools: merge, split, rotate, compress (all straightforward with `pdf-lib`)
2. Image: AVIF, HEIC → JPEG/PNG
3. Audio: MP3 ↔ WAV ↔ OGG via `ffmpeg.wasm`
4. Video: short-clip MP4 ↔ WebM (heavy WASM, big download — gate behind explicit user opt-in)
5. CSV ↔ XLSX with `sheetjs` (community edition)
6. Markdown ↔ HTML ↔ PDF

Don't build any of these until users ask. Resist scope creep.

---

## 5. Cross-Cutting Concerns

### Performance budget (non-negotiable)

| Metric | Target |
|---|---|
| Initial JS payload (landing page) | < 50 KB gzipped |
| Largest Contentful Paint | < 1.5s on 4G |
| Time to Interactive | < 2.5s on 4G |
| Lighthouse Performance | ≥ 95 |
| Lighthouse Accessibility | 100 |

Heavy WASM (pdf.js, mammoth, jSquash) is **lazy-loaded** only when the user actually opens that converter — not on the landing page.

### Accessibility

- Keyboard-only flow tested on every converter
- Drag-drop has a click-to-select fallback
- Screen-reader announcements for "file added," "converting," "done"
- WCAG AA color contrast minimum
- Respects `prefers-reduced-motion`

### SEO (yes, even for a privacy tool)

- One canonical URL per conversion: `/png-to-jpg`, `/jpg-to-png`, etc. (people search for the exact phrase)
- Schema.org `SoftwareApplication` markup
- Static HTML rendered (Astro does this by default)

### Browser support

- Last 2 versions of Chrome, Firefox, Safari, Edge
- iOS Safari 16+
- Graceful "your browser is too old" message for the rest

---

## 6. Monetization (your "buy me a coffee" model)

- Footer link to Ko-fi / Buy Me a Coffee on every page. Quiet, not pushy.
- One unobtrusive banner on the success screen after a conversion: "Liked this? You can buy me a coffee." Dismissible, remembered in `localStorage`.
- **Never** rate-limit, paywall, or ad-gate any feature. The pitch falls apart the moment you do.
- Optional later: a "Pro" desktop app version (Tauri) for $5 one-time purchase that adds OCR, batch automation, etc. Only if real demand materializes.

---

## 7. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| PDF → Word output quality is disappointing | High | Set expectations upfront in UI. Add OCR via Tesseract.js for scanned PDFs (Phase 4). Be honest in marketing — "great for text-heavy PDFs." |
| Big files crash mobile browsers (memory) | Medium | Stream where possible. Show a warning above ~50MB. |
| Library bug corrupts user file silently | Medium | Always preserve original. Conversion produces a *new* file, never overwrites. |
| User confused why we're "free" — assume scam | Low–Medium | Clear "How is this free?" section on About page. Repo is public. |
| Cloudflare Pages free tier limits | Low | 500 builds/month, unlimited bandwidth on free tier. We won't hit it. |
| Someone clones the site and adds tracking | Inherent to OSS | Trademark the name once it has traction; otherwise accept it. |

---

## 8. Names to Consider (since "AtoB" is a placeholder)

A real name needs: short, easy to spell, available .com or .app, no obvious legal issues.

- **AtoB** — already taken (.com is a trucking fintech company; would need a different TLD like atob.app or atob.tools)
- **Convertly** / **Convertly.app** — available at last check; descriptive
- **Localfile** / **Localfile.app** — emphasizes the privacy story
- **Quiet Convert** / **quietconvert.com** — "we don't talk about your files" vibe
- **Nofile** / **nofile.app** — clever; "no file leaves your device"
- **Inplace** / **inplace.app** — short, evocative

(I checked these casually — verify availability before committing.)

---

## 9. Effort Estimate

For an experienced developer working evenings/weekends:

- Phase 0: 1–2 evenings
- Phase 1 (image): 2–3 evenings → **first launch possible here**
- Phase 2 (Word→PDF): 3–5 evenings
- Phase 3 (PDF→Word): 5–8 evenings ← the long pole
- Phase 4 (polish/PWA): 2–4 evenings

**Total to all four conversions live: ~3–4 weekends of focused work.**

Cost to run: $0 on Cloudflare Pages free tier. Domain: $10–15/year if/when you buy one.

---

## 10. Pre-launch Checklist

Things to do before sharing this with the world:

**Domain & branding** *(optional — works without these but looks more professional)*
- [ ] Decide on final name (current `a-to-b` works fine on `.workers.dev`; alternatives in §8)
- [ ] Buy custom domain (if desired) — `.app` or `.tools` are good options for privacy tools (~$15/yr)
- [ ] Custom domain → Cloudflare Workers (settings → custom domains)
- [ ] When custom domain is live, set `workers_dev: false` in `wrangler.jsonc` so the workers.dev URL stops being publicly indexable
- [ ] Update `site` in `astro.config.mjs` to the custom domain

**PWA polish**
- [ ] Generate 192×192 and 512×512 PNG icons from `favicon.svg` (improves install on Android Chrome)
- [ ] Add a real OG image (1200×630 PNG) — current uses the favicon, fine but small in social previews
- [ ] Test "Add to Home Screen" on iOS and Android
- [ ] Test offline mode: load the site, kill internet, refresh — should still work

**Tip jar**
- [ ] Create Ko-fi or Buy Me a Coffee account
- [ ] Update the URL in `BaseLayout.astro` (currently placeholder `https://ko-fi.com/atob`)

**Final QA**
- [ ] Run Lighthouse on each page — target 95+ Performance, 100 Accessibility, 100 Best Practices, 100 SEO
- [ ] Test on iOS Safari, Chrome Android, Firefox, Edge
- [ ] Test the privacy claim: open Network tab in incognito, drop a file, convert, screenshot the empty Network tab as a marketing asset
- [ ] Try at least 5 real-world PDFs through PDF→Word and document any quality issues
- [ ] Write a launch announcement (HN Show post, Reddit r/privacy, r/selfhosted)

**Launch channels** *(in priority order)*
1. Personal network (friends, work Slack) — early bug reports without traffic spike
2. r/privacy or r/PrivacyTools subreddit — natural audience
3. Hacker News Show HN — title pattern: "Show HN: a → b — Free file converter that runs in your browser"
4. Product Hunt (privacy-tools category)
5. Indie Hackers
6. Twitter/X with screenshot of empty Network tab

## 11. After launch

When real users start showing up, watch for:

- **PDF→Word quality complaints** — most likely first feedback. Heuristics may need tuning per real failure cases.
- **File size limits** — large PDFs may hit browser memory limits. Add a warning above ~50 MB.
- **Format requests** — likely top asks: HEIC→JPEG (Apple), MOV→MP4, MP3↔WAV, CSV↔XLSX, JPG→PDF, PDF merge/split. Add what people ask for, not what we guess.
- **Accessibility issues** — screen-reader users may report problems we missed. Take seriously.
- **Bug reports** — set up GitHub Issues templates so reports come in structured.

---

*Plan version: v2 — May 10, 2026. All four planned phases shipped.*
