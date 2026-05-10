<!--
Thanks for contributing to a → b.
The privacy posture is non-negotiable — please confirm the checks below.
-->

## What's changing

<!-- One or two sentences describing the change. -->

## Why

<!-- The motivation. Link any related issue. -->

## How to verify

<!-- How to test locally, or what CI covers. -->

## Privacy check

- [ ] No new third-party requests
- [ ] No new tracking, analytics, or cookies
- [ ] No new upload endpoints — files still never leave the browser
- [ ] CSP unchanged, or any change is documented above

## Tests

- [ ] `pnpm test:run` passes
- [ ] `pnpm test:e2e` passes (or CI will confirm)
- [ ] `pnpm check` (type-check) passes
