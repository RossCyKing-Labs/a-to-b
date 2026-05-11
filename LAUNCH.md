# Launch playbook for a → b

This file lives next to PLAN.md as the practical "what do I say and where do I say it" reference for public launch.

## Status checklist before going public

Work through this BEFORE posting anywhere.

### Tested on real devices

- [ ] **Desktop Chrome / Edge** — every tool's happy path
- [ ] **Desktop Firefox** — every tool (some PDF rendering edge cases differ)
- [ ] **Desktop Safari** (if you have Mac access)
- [ ] **iOS Safari** — file picker works, drag-drop falls back gracefully, print dialog opens for Word→PDF
- [ ] **Chrome Android** — same checks; verify "Add to Home Screen" installs the PWA with the orange icon
- [ ] **Offline test** — load the site, disable network in DevTools, refresh — should still work

### Lighthouse — target ≥95 Performance, 100 Accessibility, 100 Best Practices, 100 SEO

Run on each route:

```
- /              (homepage)
- /image
- /word-to-pdf
- /pdf-to-word
- /merge-pdf
- /split-pdf
- /jpg-to-pdf
- /pdf-to-jpg
- /rotate-pdf
- /compress-pdf
```

How: DevTools → Lighthouse tab → Mobile + Performance/Accessibility/Best Practices/SEO → Analyze.

If anything drops below 90, screenshot it and we'll tune.

### Privacy proof screenshot

The marketing asset that makes the pitch concrete. Capture once:

1. Open the live site in an **InPrivate / Incognito** window (zero extensions, zero analytics)
2. Hard-reload, then **clear the Network tab** (🚫 icon)
3. Drop in a real file, run the conversion through to download
4. Screenshot the Network tab showing **zero requests during conversion**

Save this image — use it in the HN post, Reddit post, and as a Twitter/X attachment.

### Real-world test pass

- [ ] Convert 5 different real PDFs through PDF→Word, judge output quality honestly
- [ ] Try the new PDF tools on a few real PDFs (merge a few statements, split a contract, etc.)
- [ ] Drop a non-PDF into the PDF tools — confirm clear error message

---

## Where to post, in priority order

### Phase A: friendly fire (week 1)

People who know you. Goal: bug reports without traffic spikes.

- Personal group chats (WhatsApp / iMessage / Discord)
- Work Slack channels where "I built a thing" is welcome
- Close-circle Twitter/X if you have any presence there

Expect: 5–20 visitors. Useful signal: do people actually convert files, or just click around once and leave?

### Phase B: aligned audiences (week 2)

People who genuinely want this product. Goal: first wave of supportive users.

- **r/privacy** (~1M subs) — they're the natural audience; emphasize the no-uploads/no-tracking angle
- **r/PrivacyTools** (~100k subs) — even more niche
- **r/selfhosted** (~700k subs) — they'll like that the whole thing works offline-first
- **Indie Hackers** — supportive community for solo projects

### Phase C: scale (week 3+)

When you're confident the site holds up under traffic.

- **Hacker News — Show HN** — biggest single traffic source possible
- **Product Hunt** (privacy-tools or developer-tools category)
- **r/SideProject**
- Twitter/X with the Network-tab screenshot attached

Don't do these on week 1 — HN traffic can be 10,000+ visitors in 24 hours and any bug becomes very public very quickly.

---

## Pre-written launch posts

Adjust to your voice. The key thing: lead with the **anti-pattern you're rejecting** (uploads + tracking), not the feature list.

### Hacker News — Show HN

**Title:**
> Show HN: a → b – A file converter that runs entirely in your browser

**Body:**
> Hi HN — I built a → b because every "free" online file converter I'd used uploaded my files to a server I had to trust. I wanted a tool that was architecturally incapable of leaking my data.
>
> a → b runs entirely in the browser. There's no upload endpoint. Conversion happens locally via pdf.js, mammoth, pdf-lib, and the Canvas API. The Network tab during a conversion is empty — that's the entire pitch.
>
> Current tools:
> - Image: PNG ↔ JPEG ↔ WebP
> - Document: Word → PDF, PDF → Word (with bold/italic/hyperlink preservation)
> - PDF: Merge, Split, JPG ↔ PDF, Rotate, Compress
>
> No accounts, no file-size limits beyond your browser's memory, no ads, no tracking. The site is also a PWA so it works offline after first load. Code is on GitHub if you want to verify what it does.
>
> Things I'd love feedback on: PDF → Word quality on your real documents (the hardest converter), and whether the "verify privacy in DevTools" claim feels credible.
>
> Live: https://fromatob.app
> Repo: https://github.com/rosscyking1115/a-to-b

### Reddit r/privacy

**Title:**
> I built a file converter that's architecturally incapable of seeing your files

**Body:**
> Built this as a side project after one too many "free PDF converter" sites that uploaded my docs and showed ads. It runs entirely in your browser — no upload endpoint, no tracking, no analytics, no cookies, no accounts. Open source on GitHub.
>
> You can verify the claim yourself: open the site, open DevTools → Network tab, drop a file, convert. Zero outbound requests during conversion. (Screenshot attached.)
>
> Tools so far: PNG/JPEG/WebP, Word ↔ PDF, plus the common PDF tools (merge, split, rotate, compress, JPG ↔ PDF). All client-side.
>
> Free forever, no premium tier. Tip jar on Ko-fi if it saves you time, but never required.
>
> https://fromatob.app

### Twitter/X

**Post 1 — the proof:**
> I built a file converter. Drop a file, convert, download.
>
> The privacy claim: no file ever leaves your browser. No upload, no tracking, no ads.
>
> You can verify it: DevTools → Network tab → empty during conversion.
>
> Free, open source. https://fromatob.app
>
> [attach: Network tab screenshot]

**Post 2 — the toolset (reply to your own post 1):**
> Tools live today:
> – Image: PNG ↔ JPEG ↔ WebP
> – Word ↔ PDF
> – PDF: merge, split, rotate, compress, JPG ↔ PDF
>
> Everything client-side via pdf-lib, pdf.js, mammoth, Canvas API. No server, no analytics, no accounts.

### Product Hunt tagline

> Convert files entirely in your browser. No uploads, no tracking, no accounts. Free and open source.

---

## What to do when traffic hits

### If a real user reports a bug

1. **Don't drop everything and fix instantly.** Acknowledge fast ("thanks, looking at it"), batch fixes daily.
2. **Reproduce locally first.** If you can't, ask for: browser + version, OS, and the file (or a similar test file).
3. **Fix on a feature branch, push as a PR.** Even for hotfixes — CI catches regressions.

### If a comment thread says "this is fake / it must be uploading"

That'll happen. Respond with:
> The repo's on GitHub — every line of code is auditable. There's no upload endpoint anywhere. You can verify with DevTools → Network tab during a conversion.

Then stop arguing. The screenshot does more work than the back-and-forth.

### If the site falls over

Cloudflare Workers free tier handles a lot, but if it dies:
- Status page: dash.cloudflare.com → Workers & Pages → a-to-b → Metrics
- Roll back: Deployments tab → previous deployment → Rollback
- Disable PWA SW temporarily by bumping `CACHE_VERSION` in `public/sw.js` and pushing — forces fresh content for everyone

---

## After launch

Keep `PLAN.md §11 (After launch)` open and update it as you learn:
- Which formats people request most
- Which tools see the most use
- Which produce the most "the output is bad" complaints

Use that data to pick Phase 6+ (most likely candidates: OCR for scanned PDFs, password protect/unlock, HEIC → JPEG for iPhone users).
