/**
 * Print the event deck to web/public/deck.pdf with Playwright's Chromium, then write the inputs' hash next to the source
 * (tools/deck/deck.sha256) so tests/deck.test.ts can tell when the PDF is stale. Run: npx tsx tools/deck/build.ts
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { deckHtml, inputsHash, OUT, ROOT, STAMP } from './deck.js';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.setContent(deckHtml(), { waitUntil: 'load' });
  // Text running into the footer or off the page is a broken slide: stop rather than print it.
  const crowded = await page.evaluate(() =>
    [...document.querySelectorAll('.slide')].flatMap((slide, i) => {
      const limit = slide.querySelector('footer')?.getBoundingClientRect().top ?? 0;
      const last = [...slide.children].filter((c) => c.tagName !== 'FOOTER').pop();
      return last && last.getBoundingClientRect().bottom > limit ? [i + 1] : [];
    }),
  );
  if (crowded.length) throw new Error(`slides ${crowded.join(', ')} run into the footer`);
  const pdf = await page.pdf({ width: '1920px', height: '1080px', printBackground: true, preferCSSPageSize: true });
  writeFileSync(resolve(ROOT, OUT), pdf);
  writeFileSync(resolve(ROOT, STAMP), `${inputsHash()}\n`);
  console.log(`${OUT}: ${pdf.length} bytes`);
} finally {
  await browser.close();
}
