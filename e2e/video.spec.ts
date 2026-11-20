/**
 * The demo video: every page's banner links /video, and the judges page (one screen, banner on one line) links it in its
 * list with its length. The page plays the MP4 this site serves (206 for byte ranges, video/mp4) and fits 320 and 390 px
 * with no sideways scrolling, in English and in Malay.
 */
import config from '../config/tambat.json' with { type: 'json' };
import { en, expect, expectAccessible, expectNoOverflow, ms, test } from './fixtures.js';

test('every page links the video page: the banner, and the judges page in its list', async ({ page }) => {
  for (const path of ['/', '/lookup', '/wall', '/demo', '/pay']) {
    // Wait for the page's own first request, so leaving it does not cancel it mid-flight.
    const settled = path === '/demo' ? page.waitForResponse((r) => r.url().includes('/api/rp/session')) : null;
    await page.goto(path);
    await settled;
    const link = page.locator('.banner [data-banner="video"]');
    await expect(link).toHaveAttribute('href', '/video');
    await expect(link).toHaveText(en.banner.video);
  }
  await page.goto('/judges');
  await expect(page.locator('.banner [data-banner="video"]')).toHaveCount(0);
  const judge = page.locator('.judges a[href="/video"]');
  await expect(judge).toHaveText(en.judges.link.video.replace('{seconds}', String(config.video.seconds)));
});

test('the video page plays the file this site serves and fits a phone', async ({ page, request }) => {
  await page.goto('/video');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.video.title);
  const video = page.locator('video[data-video]');
  await expect(video).toHaveAttribute('poster', config.video.posterUrl);
  await expect(video.locator('source')).toHaveAttribute('src', config.video.url);
  await expect(page.locator('[data-video-file]')).toHaveAttribute('href', config.video.url);
  // The browser read the file's index: its length is the one the page states.
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  const duration = await video.evaluate((v: HTMLVideoElement) => v.duration);
  expect(Math.abs(duration - config.video.seconds)).toBeLessThan(1);
  await expectAccessible(page);

  const res = await request.get(config.video.url, { headers: { Range: 'bytes=0-99' } });
  expect(res.status()).toBe(206);
  expect(res.headers()['content-type']).toContain('video/mp4');
  expect((await res.body()).subarray(4, 8).toString('latin1')).toBe('ftyp');
  const poster = await request.get(config.video.posterUrl);
  expect(poster.status()).toBe(200);
  expect(poster.headers()['content-type']).toContain('image/');

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 700 });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expectNoOverflow(page);
    const box = await video.boundingBox();
    expect(box && box.x + box.width).toBeLessThanOrEqual(width);
  }
});

test('the video page is in Malay too', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/video?lang=ms');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ms.video.title);
  await expect(page.locator('[data-video-file]')).toHaveText(ms.video.download);
  await expect(page.locator('.banner [data-banner="video"]')).toHaveText(ms.banner.video);
  await expectNoOverflow(page);
});
