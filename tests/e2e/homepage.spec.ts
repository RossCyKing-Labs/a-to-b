import { expect, test } from '@playwright/test';

test.describe('homepage', () => {
  test('loads with the headline and the three live converter cards', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/a → b/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Convert files');
    await expect(page.getByRole('link', { name: /^Image converter/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Word → PDF/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Compress PDF/ })).toBeVisible();
  });

  test('removed tool routes redirect home (smoke test)', async ({ page }) => {
    // We rolled the surface area back to 3 tools while polishing fidelity.
    // The old routes still exist as redirects to the homepage so any stale
    // bookmarks / shared links don't 404.
    await page.goto('/merge-pdf');
    await expect(page).toHaveURL(/\/$/);
  });

  test('footer Buy me a coffee link points to the right Ko-fi page', async ({ page }) => {
    await page.goto('/');
    const link = page.getByRole('link', { name: /buy me a coffee/i });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', 'https://ko-fi.com/rosscyking');
  });

  test('Privacy page lists the verifiable promises', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Privacy');
    await expect(page.getByText(/Your files never leave your device/)).toBeVisible();
    await expect(page.getByText(/We don't upload your files anywhere/)).toBeVisible();
  });

  test('404 page links back to the converters', async ({ page }) => {
    await page.goto('/this-route-definitely-does-not-exist');
    await expect(page.getByText(/that page doesn't exist/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /^Image/ })).toBeVisible();
  });
});
