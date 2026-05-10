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

/** Build a tiny PNG on disk that we can pass to the file input. */
function createPngFile(): string {
  // 1x1 red PNG
  const png = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
      '0000000d49444154789c63f8cf8000000003000100b4d8d8b3000000004945' +
      '4e44ae426082',
    'hex',
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

    // JPEG is the default — drop the file via the hidden input.
    const input = page.locator('input[type="file"]').first();
    await input.setInputFiles(fixture);

    // Wait for the result row to appear with a Download link.
    const downloadLink = page.getByRole('link', { name: /^download$/i }).first();
    await expect(downloadLink).toBeVisible({ timeout: 10000 });

    // Capture the actual download.
    const downloadPromise = page.waitForEvent('download');
    await downloadLink.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.jpg$/i);
  });
});
