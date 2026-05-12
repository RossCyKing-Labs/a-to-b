import { expect, test } from '@playwright/test';
import path from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

/**
 * E2E for the image converter.
 *
 * Critically tests that all three format radios are clickable — this is the
 * exact regression we fixed when CSP was blocking React hydration. Running
 * against `pnpm preview` means the production CSP is active, so a broken
 * CSP would surface here.
 */

/**
 * Build a known-good 1×1 transparent PNG on disk that the file input can ingest.
 * This is the canonical PNG used in many test suites — valid signature, IHDR,
 * IDAT, and IEND chunks with correct CRCs.
 */
function createPngFile(): string {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk' +
      '+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  const dir = mkdtempSync(path.join(tmpdir(), 'atob-e2e-'));
  const file = path.join(dir, 'fixture.png');
  writeFileSync(file, png);
  return file;
}

test.describe('image converter', () => {
  test('renders the converter UI', async ({ page }) => {
    await page.goto('/image');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Image converter');
    await expect(page.getByText('Drop images here')).toBeVisible();
  });

  test('all three format options are clickable (regression: CSP / radio binding)', async ({
    page,
  }) => {
    await page.goto('/image');

    // JPEG is the default; click PNG and verify the visual state changes.
    const png = page.getByText('PNG', { exact: true }).first();
    await png.click();
    // The selected card has the accent border. Sniff it via inline style.
    const pngLabel = page.locator('label:has-text("PNG")');
    await expect(pngLabel).toHaveCSS('border-color', /rgb\(249, 115, 22\)|f97316/i);

    const webp = page.getByText('WebP', { exact: true }).first();
    await webp.click();
    const webpLabel = page.locator('label:has-text("WebP")');
    await expect(webpLabel).toHaveCSS('border-color', /rgb\(249, 115, 22\)|f97316/i);
  });

  test('converts a PNG to JPEG and produces a downloadable file', async ({ page }) => {
    const fixture = createPngFile();
    await page.goto('/image');

    // Wait for React to finish hydrating before we touch the input — otherwise
    // setInputFiles may run before the onChange handler is attached and silently
    // do nothing.
    await expect(page.getByText('Output format')).toBeVisible();
    await expect(page.getByText('Drop images here')).toBeVisible();

    // JPEG is the default — drop the file via the hidden input. After
    // selection the converter now stages the file in the "Ready to convert"
    // confirmation panel rather than starting work immediately.
    const input = page.locator('input[type="file"]').first();
    await input.setInputFiles(fixture);

    // Confirmation panel appears with a "Convert file" button.
    const confirmButton = page.getByRole('button', { name: /^convert file$/i });
    await expect(confirmButton).toBeVisible({ timeout: 5000 });
    await confirmButton.click();

    // Wait for the result row to appear with a Download link.
    const downloadLink = page.getByRole('link', { name: /^download$/i }).first();
    await expect(downloadLink).toBeVisible({ timeout: 15000 });

    // Capture the actual download.
    const downloadPromise = page.waitForEvent('download');
    await downloadLink.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.jpg$/i);
  });
});
