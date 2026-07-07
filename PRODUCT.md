# Product

## Register

product

## Users

Ordinary people hitting a file-size wall — the canonical case: someone submitting a
job application whose portal rejects PDFs over 2 MB. Also privacy-conscious users
who refuse to upload personal documents (contracts, tax forms, scans) to random
converter sites. They arrive mid-task, want the file fixed in under a minute, and
leave. Secondary tools (merge, split, rotate, image convert) serve the same
drop-file-get-file errand.

## Product Purpose

a → b (fromatob.app) is a free, privacy-first file converter that runs entirely in
the browser via WebAssembly. Its differentiator is *verifiable* privacy: there is no
upload endpoint, and users can watch the Network tab stay empty during a conversion.
The flagship tool is Compress PDF with a target-size mode ("fit under 2 MB").
Success = the file lands under the user's limit with the sharpest possible quality,
and the user trusts (and can verify) that it never left their device.

## Brand Personality

Precision instrument, honest, quiet. The UI should feel like a well-made local tool
doing real computation on the user's own machine — tactile, immediate, matter-of-fact
— never like a cloud service. Motion reads as "local machinery turning", never as
"waiting on a server".

## Anti-references

- Ad-cluttered converter sites (iLovePDF/Smallpdf feel): upsell banners, fake
  progress bars, "your file is being uploaded…" theater.
- Cloud-app loading idioms: spinners, indeterminate throbbers, skeleton shimmer for
  work that is actually CPU-bound and measurable.
- Marketing-site choreography on tool screens (scroll reveals, parallax, confetti).

## Design Principles

1. **Verifiable, not promised** — the privacy claim is shown (Network tab, "working
   locally" copy), never just asserted. Zero external requests is a hard constraint:
   no CDNs, no remote fonts, no third-party assets.
2. **Show the real work** — progress, sizes, and phases come from the actual engine,
   not simulations. Honest numbers beat smooth fictions.
3. **One signature moment** — the shrink reveal (size counts down to the result) is
   the single bold animation; everything else stays quiet and functional.
4. **Compositor-only motion** — animate transform/opacity; 150–250 ms for state
   changes; reduced-motion always degrades to instant states.
5. **The tool disappears into the task** — familiar affordances, system fonts,
   restrained accent (brand orange #f97316 for actions/state only).

## Accessibility & Inclusion

- WCAG AA contrast in both themes (light `#fafaf9`/dark `#0a0a0a`, tokens in
  `src/styles/global.css`).
- `prefers-reduced-motion: reduce` honored everywhere (instant states, no loops).
- Visible focus ring (2px accent) on all interactive elements; keyboard-operable
  drop zones and accordions.
