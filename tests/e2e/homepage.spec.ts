import { expect, test } from '@playwright/test';

test.describe('homepage', () => {
  test('loads with the headline and all live converter cards', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/a → b/);
    // The homepage leads with the PDF compressor (the #1 use case).
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Make your PDF');
    // Scope to <main>: the header's Tools dropdown and the footer also link to
    // every tool, so a page-wide role query would match multiple elements.
    const main = page.locator('main');
    await expect(main.getByRole('link', { name: /^Image converter/ })).toBeVisible();
    await expect(main.getByRole('link', { name: /^Merge PDF/ })).toBeVisible();
    await expect(main.getByRole('link', { name: /^Split PDF/ })).toBeVisible();
    await expect(main.getByRole('link', { name: /^JPG → PDF/ })).toBeVisible();
    await expect(main.getByRole('link', { name: /^PDF → JPG/ })).toBeVisible();
    await expect(main.getByRole('link', { name: /^Rotate PDF/ })).toBeVisible();
    await expect(main.getByRole('link', { name: /^Compress PDF/ })).toBeVisible();
  });

  test('Word↔PDF routes redirect home', async ({ page }) => {
    // Word→PDF and PDF→Word are dropped from the live surface. Microsoft Word
    // and Google Docs already handle these for free; we focus on tools where
    // no good free private alternative exists. Old shared links redirect home.
    await page.goto('/word-to-pdf');
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/pdf-to-word');
    await expect(page).toHaveURL(/\/$/);
  });

  test('footer Ko-fi link points to the right page', async ({ page }) => {
    await page.goto('/');
    const link = page.locator('footer').getByRole('link', { name: /^Ko-fi$/ });
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
